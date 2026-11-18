package com.skinclinic.controller;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.http.*;
import java.util.Map;
@RestControllerAdvice
public class ApiExceptionHandler{
 @ExceptionHandler(ResponseStatusException.class) public ResponseEntity<?> status(ResponseStatusException e){return ResponseEntity.status(e.getStatusCode()).body(Map.of("error",e.getReason()==null?"请求失败":e.getReason()));}
 @ExceptionHandler(MaxUploadSizeExceededException.class) public ResponseEntity<?> size(MaxUploadSizeExceededException e){return ResponseEntity.status(413).body(Map.of("error","请选择10MB以内的图片"));}
 @ExceptionHandler({org.springframework.http.converter.HttpMessageNotReadableException.class,org.springframework.web.multipart.support.MissingServletRequestPartException.class})
 public ResponseEntity<?> invalid(Exception e){return ResponseEntity.badRequest().body(Map.of("error","请求格式无效，请检查输入"));}
 @ExceptionHandler(Exception.class) public ResponseEntity<?> unexpected(Exception e){return ResponseEntity.internalServerError().body(Map.of("error","服务处理失败，请稍后重试"));}
}
