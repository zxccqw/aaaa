package com.skinclinic;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class MedicalControllerTest {
 private static final Path STORAGE;
 static {
  try { STORAGE = Files.createTempDirectory("skin-controller-test-"); }
  catch (Exception e) { throw new ExceptionInInitializerError(e); }
 }
 @DynamicPropertySource
 static void properties(DynamicPropertyRegistry registry) {
  registry.add("skin.storage", () -> STORAGE.toString());
  registry.add("DOCTOR_USERNAME", () -> "test-doctor");
  registry.add("DOCTOR_EMAIL", () -> "doctor@example.test");
  registry.add("DOCTOR_PASSWORD", () -> "doctor-test-password");
  registry.add("ADMIN_USERNAME", () -> "test-admin");
  registry.add("ADMIN_PASSWORD", () -> "admin-test-password");
 }
 @Autowired MockMvc mvc;
 @Autowired ObjectMapper mapper;
 private org.springframework.mock.web.MockHttpSession login(String account, String password, String role) throws Exception {
  String body = mapper.createObjectNode().put("account", account).put("password", password).toString();
  return (org.springframework.mock.web.MockHttpSession) mvc.perform(
    post("/api/auth/login").contentType("application/json").content(body))
   .andExpect(status().isOk()).andExpect(jsonPath("$.role").value(role))
   .andReturn().getRequest().getSession(false);
 }
 @Test void roleAndLogoutAreEnforcedBySpringBoot() throws Exception {
  mvc.perform(get("/api/medical/records")).andExpect(status().isUnauthorized());
  mvc.perform(post("/api/auth/login").contentType("application/json")
    .content("{\"account\":\"test-admin\",\"password\":\"doctor-test-password\"}"))
   .andExpect(status().isUnauthorized());
  var doctor = login("doctor@example.test", "doctor-test-password", "doctor");
  mvc.perform(get("/api/medical/records").session(doctor)).andExpect(status().isOk());
  mvc.perform(get("/api/medical/patients").session(doctor)).andExpect(status().isForbidden());
  mvc.perform(get("/api/medical/status").session(doctor)).andExpect(status().isForbidden());
  mvc.perform(get("/security-data.js").session(doctor)).andExpect(status().isForbidden());
  mvc.perform(get("/api/auth/session").session(doctor)).andExpect(jsonPath("$.role").value("doctor"));
  mvc.perform(post("/api/auth/logout").session(doctor)).andExpect(status().isNoContent());
  org.junit.jupiter.api.Assertions.assertTrue(doctor.isInvalid());
 }
 @Test void createSaveAndVersionConflictThroughHttpRoutes() throws Exception {
  var doctor = login("test-doctor", "doctor-test-password", "doctor");
  var admin = login("test-admin", "admin-test-password", "admin");
  mvc.perform(post("/api/medical/records").session(admin).contentType("application/json").content("{}")).andExpect(status().isForbidden());
  var input = mapper.createObjectNode();
  input.put("patientId", "TEST").put("patientName", "测试").put("center", "lab");
  input.put("type", "皮肤检验").put("title", "接口测试").put("date", "2026-11-07");
  String response = mvc.perform(post("/api/medical/records").session(doctor).contentType("application/json").content(input.toString()))
   .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
  var saved = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(response);
  String url = "/api/medical/records/" + saved.path("id").asText();
  saved.put("findings", "可见观察记录").put("conclusion", "需人工复核").put("status", "已复核");
  saved.putObject("analysis").put("resultImageUrl", "/api/medical/media/test-result.png");
  mvc.perform(put(url).session(doctor).contentType("application/json").content(saved.toString()))
   .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(2));
  mvc.perform(get(url).session(doctor)).andExpect(status().isOk()).andExpect(jsonPath("$.analysis.resultImageUrl").value("/api/medical/media/test-result.png"));
  mvc.perform(put(url).session(doctor).contentType("application/json").content(saved.toString())).andExpect(status().isConflict());
  mvc.perform(get("/api/medical/patients/TEST/reports").session(admin)).andExpect(status().isOk()).andExpect(jsonPath("$[0].status").value("已复核"));
 }
 @Test void invalidRecordAndCrossOriginWritesAreRejected() throws Exception {
  var doctor = login("test-doctor", "doctor-test-password", "doctor");
  mvc.perform(post("/api/medical/records").session(doctor).contentType("application/json").content("{}"))
   .andExpect(status().isBadRequest());
  mvc.perform(post("/api/medical/records").header("Origin", "https://untrusted.example").contentType("application/json").content("{}"))
   .andExpect(status().isForbidden());
 }
}


