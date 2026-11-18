package com.skinclinic.dto;
import java.util.List;
public record AnalysisResult(String findings,String conclusion,List<Region> regions,
 String originalImageUrl,String resultImageUrl,String imageCaption,String model,String analyzedAt){
 public record Region(double x,double y,double width,double height,String label){}
}
