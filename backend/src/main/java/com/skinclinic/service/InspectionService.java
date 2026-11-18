package com.skinclinic.service;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.skinclinic.repository.InspectionRepository;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.time.LocalDate;
import java.util.*;
@Service
public class InspectionService {
 private final InspectionRepository repository;
 public InspectionService(InspectionRepository repository){this.repository=repository;}
 public List<ObjectNode> list(){return repository.findAll();}
 public ObjectNode get(String id){return repository.findById(id).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"检查不存在"));}
 public ObjectNode create(ObjectNode record){validate(record);return repository.create(record);}
 public ObjectNode update(String id,ObjectNode record){
  ObjectNode old=get(id);validate(record);
  if(!old.path("patientId").asText().equals(record.path("patientId").asText())||!old.path("center").asText().equals(record.path("center").asText()))bad("患者编号和所属中心不能更改");
  if(!record.path("version").isIntegralNumber())bad("需要提交记录版本");
  return repository.update(id,record,record.path("version").asInt());
 }
 public void delete(String id){get(id);repository.delete(id);}
 private void validate(ObjectNode record){
  for(String field:List.of("patientId","patientName","center","type","title","date"))
   if(!record.path(field).isTextual()||record.path(field).asText().isBlank()||record.path(field).asText().length()>120)bad(field+"必填且最多120字符");
  if(!"lab".equals(record.path("center").asText())||!"皮肤检验".equals(record.path("type").asText()))bad("仅支持皮肤检验");
  try{LocalDate.parse(record.path("date").asText());}catch(Exception e){bad("日期格式无效");}
  for(String field:List.of("annotations","metrics","events")){
   if(!record.has(field))record.putArray(field);
   if(!record.path(field).isArray()||record.path(field).size()>1000)bad(field+"格式无效");
  }
  if(!record.has("status"))record.put("status","待处理");
  if(!Set.of("待处理","草稿","已复核").contains(record.path("status").asText()))bad("报告状态无效");
  for(String field:List.of("findings","conclusion")){
   if(!record.has(field))record.put(field,"");
   if(!record.path(field).isTextual()||record.path(field).asText().length()>40000)bad(field+"格式无效");
  }
  if("已复核".equals(record.path("status").asText())&&record.path("conclusion").asText().isBlank())bad("请填写结论后复核");
  record.remove("demo");
 }
 private void bad(String message){throw new ResponseStatusException(HttpStatus.BAD_REQUEST,message);}
}
