package com.skinclinic;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skinclinic.repository.FileInspectionRepository;
import com.skinclinic.service.SkinAnalysisService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.mock.web.MockMultipartFile;
import java.nio.file.*;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
class BackendTest {
 @TempDir Path directory;
 @Test void recordsSurviveRestartAndStaleUpdatesAreRejected() throws Exception {
  var mapper=new ObjectMapper();
  var repository=new FileInspectionRepository(mapper,directory.toString());
  var record=mapper.createObjectNode().put("patientId","TEST");
  var created=repository.create(record);
  String id=created.path("id").asText();
  var reopened=new FileInspectionRepository(mapper,directory.toString());
  assertEquals(id,reopened.findById(id).orElseThrow().path("id").asText());
  var updated=reopened.update(id,created,1);
  assertEquals(2,updated.path("version").asInt());
  assertEquals(409,assertThrows(ResponseStatusException.class,()->reopened.update(id,created,1)).getStatusCode().value());
 }
 @Test void resultImagesResolveUnderRelativeStoragePaths() throws Exception {
  Path relative=Path.of("").toAbsolutePath().relativize(directory.toAbsolutePath());
  var service=new SkinAnalysisService(new ObjectMapper(),"test-key","deepseek-flash",relative.toString());
  String name=UUID.randomUUID()+"-result.png";
  Files.write(directory.resolve("media").resolve(name),new byte[]{1,2,3});
  assertTrue(Files.exists(service.image(name)));
  assertThrows(ResponseStatusException.class,()->service.image("../secret"));
 }
 @Test void malformedImagesAreRejectedBeforeCallingTheProvider() throws Exception {
  var service=new SkinAnalysisService(new ObjectMapper(),"test-key","deepseek-flash",directory.toString());
  var file=new MockMultipartFile("image","test.png","image/png",new byte[]{1,2,3});
  assertEquals(400,assertThrows(ResponseStatusException.class,()->service.analyze(file)).getStatusCode().value());
 }
}
