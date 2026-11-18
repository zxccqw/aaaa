package com.skinclinic.repository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Repository;
import org.springframework.web.server.ResponseStatusException;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
@Repository
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name = "skin.storage-type", havingValue = "file", matchIfMissing = true)
public class FileInspectionRepository implements InspectionRepository {
 private final ObjectMapper mapper;
 private final Path file;
 private final LinkedHashMap<String,ObjectNode> records=new LinkedHashMap<>();
 public FileInspectionRepository(ObjectMapper mapper,@Value("${skin.storage}") String directory)throws Exception {
  this.mapper=mapper;file=Path.of(directory).toAbsolutePath().resolve("inspections.json");
  Files.createDirectories(file.getParent());
  if(Files.exists(file)) for(var value:mapper.readTree(file.toFile())) {
   ObjectNode record=(ObjectNode)value;records.put(record.path("id").asText(),record);
  }
 }
 public synchronized List<ObjectNode> findAll(){return records.values().stream().map(ObjectNode::deepCopy).toList();}
 public synchronized Optional<ObjectNode> findById(String id){return Optional.ofNullable(records.get(id)).map(ObjectNode::deepCopy);}
 public synchronized ObjectNode create(ObjectNode input){
  ObjectNode record=input.deepCopy();
  record.put("id",UUID.randomUUID().toString()).put("version",1);
  record.put("createdAt",Instant.now().toString()).put("updatedAt",Instant.now().toString());
  var next=new LinkedHashMap<>(records);next.put(record.path("id").asText(),record);commit(next);return record.deepCopy();
 }
 public synchronized ObjectNode update(String id,ObjectNode input,int expectedVersion){
  ObjectNode old=records.get(id);
  if(old==null)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"检查不存在");
  if(old.path("version").asInt()!=expectedVersion)throw new ResponseStatusException(HttpStatus.CONFLICT,"记录已修改，请刷新后重试");
  ObjectNode record=input.deepCopy();record.put("id",id).put("version",expectedVersion+1);
  record.put("createdAt",old.path("createdAt").asText()).put("updatedAt",Instant.now().toString());
  var next=new LinkedHashMap<>(records);next.put(id,record);commit(next);return record.deepCopy();
 }
 public synchronized void delete(String id){
  if(!records.containsKey(id))throw new ResponseStatusException(HttpStatus.NOT_FOUND,"检查不存在");
  var next=new LinkedHashMap<>(records);next.remove(id);commit(next);
 }
 private void commit(LinkedHashMap<String,ObjectNode> next){
  Path temporary=null;
  try{
   temporary=Files.createTempFile(file.getParent(),"inspections-",".tmp");
   mapper.writeValue(temporary.toFile(),next.values());
   Files.move(temporary,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
   records.clear();records.putAll(next);
  }catch(Exception e){throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,"记录保存失败");}
  finally{if(temporary!=null)try{Files.deleteIfExists(temporary);}catch(Exception ignored){}}
 }
}

