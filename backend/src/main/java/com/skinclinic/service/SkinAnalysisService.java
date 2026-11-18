package com.skinclinic.service;
import com.fasterxml.jackson.databind.*;
import com.skinclinic.dto.AnalysisResult;
import com.skinclinic.dto.AnalysisResult.Region;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.multipart.MultipartFile;
import javax.imageio.*;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.List;
@Service
public class SkinAnalysisService {
 private final ObjectMapper mapper;
 private final String apiKey,model;
 private final Path media;
 @org.springframework.beans.factory.annotation.Value("${deepseek.enabled:true}") private boolean enabled=true;
 private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(20)).build();
 private final java.util.concurrent.Semaphore slots=new java.util.concurrent.Semaphore(2);
 public SkinAnalysisService(ObjectMapper mapper,@Value("${deepseek.api-key}") String key,
  @Value("${deepseek.model}") String model,@Value("${skin.storage}") String directory)throws IOException{
  this.mapper=mapper;this.apiKey=key;this.model=model;
  media=Path.of(directory).toAbsolutePath().normalize().resolve("media");Files.createDirectories(media);
 }
 public boolean configured(){return enabled&&!apiKey.isBlank();}
 public AnalysisResult analyze(MultipartFile upload){return analyze(upload,"image",null);}
 public AnalysisResult analyze(MultipartFile upload,String mode,Double lesionAreaRatio){
  String normalized="segmentation".equals(mode)?"segmentation":"image";
  if(!enabled)throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"DeepSeek 图片分析已停用，请使用「AI 病灶分割」（SkinFusion-Seg）");
  if(apiKey.isBlank())throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"后端尚未配置DeepSeek密钥");
  if(upload.isEmpty()||upload.getSize()>10*1024*1024)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请选择10MB以内的PNG/JPEG图片");
  if(!slots.tryAcquire())throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"分析繁忙，请稍后重试");
  try{return analyzeImage(upload,normalized,lesionAreaRatio);}
  catch(ResponseStatusException e){throw e;}
  catch(InterruptedException e){Thread.currentThread().interrupt();throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"分析已中断");}
  catch(java.net.http.HttpTimeoutException e){throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT,"图片分析超时，请重试");}
  catch(Exception e){throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,"图片分析失败，请重试或检查后端模型配置");}
  finally{slots.release();}
 }
 private AnalysisResult analyzeImage(MultipartFile upload,String mode,Double lesionAreaRatio)throws Exception{
  BufferedImage image;
  try(var stream=ImageIO.createImageInputStream(new ByteArrayInputStream(upload.getBytes()))){
   var readers=ImageIO.getImageReaders(stream);
   if(!readers.hasNext())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无法解码图片");
   ImageReader reader=readers.next();
   try{
    reader.setInput(stream);
    String format=reader.getFormatName().toLowerCase(Locale.ROOT);
    int width=reader.getWidth(0),height=reader.getHeight(0);
    if(!Set.of("png","jpeg","jpg").contains(format)||width>8192||height>8192||(long)width*height>25000000)
     throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"只支持PNG/JPEG，边长最多8192，总像素最多2500万");
    image=reader.read(0);
   }finally{reader.dispose();}
  }
  var out=new ByteArrayOutputStream();ImageIO.write(image,"png",out);
  String dataUrl="data:image/png;base64,"+Base64.getEncoder().encodeToString(out.toByteArray());
  String prompt;
  if("segmentation".equals(mode)){
   String area=(lesionAreaRatio!=null&&Double.isFinite(lesionAreaRatio)&&lesionAreaRatio>=0&&lesionAreaRatio<=1)
    ?String.format(Locale.ROOT,"AI分割的病灶面积占比约 %.1f%%。",lesionAreaRatio*100):"";
   prompt="这是AI病灶分割叠加图，彩色覆盖/掩码区域为模型识别的病灶范围。"+area+
    "请只依据分割覆盖区域，为皮肤科医生提供辅助观察：findings描述分割区域的位置、范围、边界、颜色、形态和图像质量；conclusion给出辅助结论，概括分割区域提示的形态特征；不要输出免责声明、诊断限制、处方建议或面积测量免责说明；regions为空数组。只输出JSON：findings为中文检查所见，conclusion为中文辅助结论，regions为空数组。";
  }else{
   prompt="为皮肤科医生提供谨慎的图片辅助观察。非皮肤图请明确说明无法进行皮肤分析。只描述可见形态、颜色、分布、图像质量和待核实信息，不推断身份，不作确定诊断，不提供处方，不编造测量。只输出JSON：findings为中文检查所见，conclusion为中文辅助结论并提醒需医生结合病史复核；regions为数组最多5项，只有明确可定位的皮肤观察区域才填写x,y,width,height（0至1原图归一化坐标）和label，否则空数组。";
  }
  var body=Map.of("model",model,"messages",List.of(
   Map.of("role","system","content","你是医生使用的影像观察助手，仅依据可见图片，保持不确定性。"),
   Map.of("role","user","content",List.of(Map.of("type","text","text",prompt),Map.of("type","image_url","image_url",Map.of("url",dataUrl))))),
   "response_format",Map.of("type","json_object"),"max_tokens",3000,"stream",false);
  var request=HttpRequest.newBuilder(URI.create("https://api.deepseek.com/chat/completions")).timeout(Duration.ofSeconds(150))
   .header("Content-Type","application/json").header("Authorization","Bearer "+apiKey)
   .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body))).build();
  var response=client.send(request,HttpResponse.BodyHandlers.ofString());
  if(response.statusCode()!=200){
   String message=switch(response.statusCode()){
    case 401,403->"DeepSeek密钥无效或无模型访问权限";
    case 402->"DeepSeek账户余额不足";
    case 429->"DeepSeek调用频繁，请稍后重试";
    case 400,404,422->"DeepSeek拒绝图片请求，请检查模型是否支持图像输入";
    default->"DeepSeek服务暂不可用（HTTP "+response.statusCode()+"）";
   };throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,message);
  }
  String content=mapper.readTree(response.body()).path("choices").path(0).path("message").path("content").asText();
  int first=content.indexOf('{'),last=content.lastIndexOf('}');
  if(first<0||last<first)throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,"模型结果格式无效");
  JsonNode answer=mapper.readTree(content.substring(first,last+1));
  String findings=answer.path("findings").asText().trim(),conclusion=answer.path("conclusion").asText().trim();
  if("segmentation".equals(mode)){
   findings=stripCaveats(findings);
   conclusion=stripCaveats(conclusion);
  }
  if(findings.isEmpty()||conclusion.isEmpty())throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,"模型未返回完整检查所见和结论");
  List<Region> regions=new ArrayList<>();
  if(!"segmentation".equals(mode)){
   for(JsonNode box:answer.path("regions")){
    double x=box.path("x").asDouble(-1),y=box.path("y").asDouble(-1),w=box.path("width").asDouble(-1),h=box.path("height").asDouble(-1);
    if(regions.size()<5&&Double.isFinite(x+y+w+h)&&x>=0&&y>=0&&w>0&&h>0&&x+w<=1&&y+h<=1)
     regions.add(new Region(x,y,w,h,box.path("label").asText("观察区域")));
   }
  }
  String id=UUID.randomUUID().toString();
  Path original=media.resolve(id+"-original.png"),result=media.resolve(id+"-result.png");
  ImageIO.write(image,"png",original.toFile());
  BufferedImage annotated=new BufferedImage(image.getWidth(),image.getHeight(),BufferedImage.TYPE_INT_RGB);
  Graphics2D graphics=annotated.createGraphics();
  try{
   graphics.drawImage(image,0,0,Color.WHITE,null);graphics.setColor(new Color(255,185,40));
   graphics.setStroke(new BasicStroke(Math.max(2,image.getWidth()/400f)));
   graphics.setFont(new Font(Font.SANS_SERIF,Font.BOLD,Math.max(14,image.getWidth()/45)));
   for(int i=0;i<regions.size();i++){
    Region r=regions.get(i);int x=(int)(r.x()*image.getWidth()),y=(int)(r.y()*image.getHeight());
    graphics.drawRect(x,y,(int)(r.width()*image.getWidth()),(int)(r.height()*image.getHeight()));
    graphics.drawString("#"+(i+1),x+4,Math.min(image.getHeight()-5,y+graphics.getFont().getSize()));
   }
  }finally{graphics.dispose();}
  ImageIO.write(annotated,"png",result.toFile());
  return new AnalysisResult(findings,conclusion,regions,"/api/medical/media/"+original.getFileName(),"/api/medical/media/"+result.getFileName(),
   "segmentation".equals(mode)?"基于AI病灶分割叠加图的辅助分析":(regions.isEmpty()?"原图参考，模型未返回可靠定位区域":"原图与AI观察区域标注，定位需医生复核"),
   "segmentation".equals(mode)?"AI辅助分析":model,Instant.now().toString());
 }
 private static String stripCaveats(String text){
  StringBuilder kept=new StringBuilder();
  for(String part:text.split("(?<=[。；!?\\n])")){
   String sentence=part.trim();
   if(sentence.isEmpty())continue;
   if(sentence.matches(".*(不作确定诊断|不提供处方|不编造测量|非临床测量|仅供[^。；\\n]*参考|需[^。；\\n]*复核|不能替代[^。；\\n]*|面积占比[^。；\\n]*非临床|诊断依据|免责声明).*"))continue;
   kept.append(sentence);
  }
  return kept.toString().trim();
 } public Path image(String filename){
  if(!filename.matches("[a-f0-9-]{36}-(original|result)\\.png"))throw new ResponseStatusException(HttpStatus.NOT_FOUND);
  Path path=media.resolve(filename).normalize();
  if(!path.startsWith(media)||!Files.isRegularFile(path))throw new ResponseStatusException(HttpStatus.NOT_FOUND);
  return path;
 }
}
