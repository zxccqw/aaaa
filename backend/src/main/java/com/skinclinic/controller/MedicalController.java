package com.skinclinic.controller;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.skinclinic.service.*;
import com.skinclinic.dto.AnalysisResult;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import org.springframework.core.io.FileSystemResource;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import jakarta.servlet.http.HttpSession;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
@RestController
@RequestMapping("/api/medical")
public class MedicalController{
 private final InspectionService inspections;
 private final SkinAnalysisService analysis;
 private final SkinFusionService segmentation;
 public MedicalController(InspectionService inspections,SkinAnalysisService analysis,SkinFusionService segmentation){
  this.inspections=inspections;this.analysis=analysis;this.segmentation=segmentation;
 }
 @org.springframework.beans.factory.annotation.Value("${skin.storage-type}") private String storageType;
 @GetMapping("/status") public Map<String,Object> status(){return Map.of("storage",storageType.equals("mysql")?"mysql":"file-adapter","databaseConfigured",storageType.equals("mysql"),"aiConfigured",analysis.configured(),"segmentationConfigured",true);}
 @GetMapping("/records") public List<ObjectNode> records(){return inspections.list();}
 @GetMapping("/centers/lab/records") public List<ObjectNode> skinRecords(){return inspections.list().stream().filter(r->r.path("center").asText().equals("lab")).toList();}
 @GetMapping("/records/{id}") public ObjectNode record(@PathVariable String id){return inspections.get(id);}
 @PostMapping("/records") @ResponseStatus(HttpStatus.CREATED) public ObjectNode create(@RequestBody ObjectNode record){return inspections.create(record);}
 @PutMapping("/records/{id}") public ObjectNode update(@PathVariable String id,@RequestBody ObjectNode record){return inspections.update(id,record);}
 @DeleteMapping("/records/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) public void delete(@PathVariable String id){inspections.delete(id);}
 @GetMapping("/patients") public Collection<Map<String,String>> patients(){
  Map<String,Map<String,String>> patients=new LinkedHashMap<>();
  for(ObjectNode r:inspections.list())patients.put(r.path("patientId").asText(),Map.of("patientId",r.path("patientId").asText(),"patientName",r.path("patientName").asText()));
  return patients.values();
 }
 @GetMapping("/patients/{id}/reports") public List<ObjectNode> reports(@PathVariable String id){return inspections.list().stream().filter(r->r.path("patientId").asText().equals(id)).toList();}
 @GetMapping("/feasibility-runs") public List<ObjectNode> feasibilityRuns(HttpSession session){return sessionRuns(session,"cs1FeasibilityRuns");}
 @PostMapping("/feasibility-runs") public ObjectNode saveFeasibilityRun(@RequestBody ObjectNode run,HttpSession session){return saveSessionRun(session,"cs1FeasibilityRuns",run);}
 @DeleteMapping("/feasibility-runs") @ResponseStatus(HttpStatus.NO_CONTENT) public void clearFeasibilityRuns(HttpSession session){session.removeAttribute("cs1FeasibilityRuns");}
 @GetMapping("/encrypted-runs") public List<ObjectNode> encryptedRuns(HttpSession session){return sessionRuns(session,"cs2EncryptedRuns");}
 @PostMapping("/encrypted-runs") public ObjectNode saveEncryptedRun(@RequestBody ObjectNode run,HttpSession session){return saveSessionRun(session,"cs2EncryptedRuns",run);}
 @DeleteMapping("/encrypted-runs") @ResponseStatus(HttpStatus.NO_CONTENT) public void clearEncryptedRuns(HttpSession session){session.removeAttribute("cs2EncryptedRuns");}
 @GetMapping("/chart-tasks") public List<ObjectNode> chartTasks(HttpSession session){return syncChartTasks(session);}
 @PostMapping("/chart-tasks") public ObjectNode startChartTask(@RequestBody ObjectNode request,HttpSession session){
  if(request==null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"任务不能为空");
  ObjectNode task=request.deepCopy();
  String id=task.path("id").asText();
  if(id.isBlank()) id=UUID.randomUUID().toString();
  String kind=task.path("kind").asText("");
  if(!Set.of("cs1","cs2","pb").contains(kind)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"未知图表任务类型");
  long duration=Math.max(500,Math.min(600000,task.path("durationMs").asLong(5000)));
  task.put("id",id);
  task.put("kind",kind);
  task.put("durationMs",duration);
  task.put("startedAt",Instant.now().toEpochMilli());
  task.put("status","running");
  task.put("progress",0.0);
  task.put("finalized",false);
  final String taskId=id;
  List<ObjectNode> tasks=sessionChartTasks(session);
  tasks.removeIf(item->taskId.equals(item.path("id").asText()));
  tasks.add(task);
  if(tasks.size()>50) tasks=new ArrayList<>(tasks.subList(tasks.size()-50,tasks.size()));
  session.setAttribute("chartTasks",tasks);
  return task;
 }
 @GetMapping("/chart-tasks/{id}") public ObjectNode chartTask(@PathVariable String id,HttpSession session){
  List<ObjectNode> tasks=syncChartTasks(session);
  return tasks.stream().filter(t->id.equals(t.path("id").asText())).findFirst()
    .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"任务不存在"));
 }
 private static List<ObjectNode> sessionChartTasks(HttpSession session){
  Object value=session.getAttribute("chartTasks");
  if(value instanceof List<?> list){
   List<ObjectNode> tasks=new ArrayList<>();
   for(Object item:list) if(item instanceof ObjectNode node) tasks.add(node);
   return tasks;
  }
  return new ArrayList<>();
 }
 private static List<ObjectNode> syncChartTasks(HttpSession session){
  List<ObjectNode> tasks=sessionChartTasks(session);
  long now=Instant.now().toEpochMilli();
  for(ObjectNode task:tasks){
   if("completed".equals(task.path("status").asText())) continue;
   long startedAt=task.path("startedAt").asLong(now);
   long duration=Math.max(1,task.path("durationMs").asLong(5000));
   long elapsed=Math.max(0,now-startedAt);
   double progress=Math.min(1.0,elapsed/(double)duration);
   task.put("progress",progress);
   task.put("elapsedMs",Math.min(duration,elapsed));
   if(progress>=1.0){
    if(!task.path("finalized").asBoolean(false)){
     finalizeChartTask(session,task);
     task.put("finalized",true);
    }
    task.put("status","completed");
    task.put("completedAt",now);
   }else{
    task.put("status","running");
   }
  }
  session.setAttribute("chartTasks",tasks);
  return tasks;
 }
 private static void finalizeChartTask(HttpSession session,ObjectNode task){
  String kind=task.path("kind").asText("");
  var payload=task.path("payload");
  if(!payload.isObject()) return;
  var run=payload.path("run");
  if(!run.isObject()) return;
  if("cs1".equals(kind)) saveSessionRun(session,"cs1FeasibilityRuns",(ObjectNode)run);
  else if("cs2".equals(kind)) saveSessionRun(session,"cs2EncryptedRuns",(ObjectNode)run);
 }
 private static List<ObjectNode> sessionRuns(HttpSession session,String key){
  Object value=session.getAttribute(key);
  if(value instanceof List<?> list){
   List<ObjectNode> runs=new ArrayList<>();
   for(Object item:list) if(item instanceof ObjectNode node) runs.add(node);
   return runs;
  }
  return new ArrayList<>();
 }
 private static ObjectNode saveSessionRun(HttpSession session,String key,ObjectNode run){
  if(run==null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"运行记录不能为空");
  String id=run.path("id").asText();
  if(id.isBlank()) id=UUID.randomUUID().toString();
  final String runId=id;
  ObjectNode copy=run.deepCopy();
  copy.put("id",runId);
  copy.put("savedAt",Instant.now().toString());
  List<ObjectNode> runs=sessionRuns(session,key);
  runs.removeIf(item->runId.equals(item.path("id").asText()));
  runs.add(copy);
  if(runs.size()>50) runs=new ArrayList<>(runs.subList(runs.size()-50,runs.size()));
  session.setAttribute(key,runs);
  return copy;
 }
 @PostMapping(value="/analysis",consumes=MediaType.MULTIPART_FORM_DATA_VALUE) public AnalysisResult analyze(@RequestParam("image") MultipartFile image,
  @RequestParam(value="mode",defaultValue="image") String mode,
  @RequestParam(value="lesionAreaRatio",required=false) Double lesionAreaRatio){return analysis.analyze(image,mode,lesionAreaRatio);}
 @PostMapping(value="/segment",consumes=MediaType.MULTIPART_FORM_DATA_VALUE) public Map<String,Object> segment(@RequestParam("image") MultipartFile image){return segmentation.segment(image);}
 @GetMapping(value="/media/{filename}",produces=MediaType.IMAGE_PNG_VALUE) public ResponseEntity<FileSystemResource> image(@PathVariable String filename){
  Path path=filename.matches("[a-f0-9-]{36}-(mask|overlay)\\.png")?segmentation.image(filename):analysis.image(filename);
  return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new FileSystemResource(path));
 }
}
