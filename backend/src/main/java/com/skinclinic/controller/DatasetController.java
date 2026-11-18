package com.skinclinic.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/** Serves the converted ISIC2018 test subset for the doctor-side dataset picker. */
@RestController
@RequestMapping("/api/medical/dataset")
public class DatasetController {
    private final Path dir;
    private final ObjectMapper mapper;

    public DatasetController(ObjectMapper mapper,
                             @Value("${skin.storage}") String storage,
                             @Value("${skinfusion.dataset-dir:isic-dataset}") String subdir) {
        this.mapper = mapper;
        this.dir = Path.of(storage).toAbsolutePath().normalize().resolve(subdir).normalize();
    }

    @GetMapping
    public Map<String, Object> list() throws IOException {
        Path index = dir.resolve("index.json");
        if (!Files.isRegularFile(index)) {
            return Map.of("dataset", "ISIC2018", "split", "test", "count", 0, "items", List.of());
        }
        return mapper.readValue(Files.readAllBytes(index), Map.class);
    }

    @GetMapping(value = "/{id}", produces = MediaType.IMAGE_PNG_VALUE)
    public ResponseEntity<FileSystemResource> image(@PathVariable String id) {
        return serve("images", id);
    }

    @GetMapping(value = "/{id}/thumb", produces = MediaType.IMAGE_PNG_VALUE)
    public ResponseEntity<FileSystemResource> thumb(@PathVariable String id) {
        return serve("thumbs", id);
    }

    @GetMapping(value = "/{id}/mask", produces = MediaType.IMAGE_PNG_VALUE)
    public ResponseEntity<FileSystemResource> mask(@PathVariable String id) {
        return serve("masks", id);
    }

    private ResponseEntity<FileSystemResource> serve(String group, String id) {
        if (!id.matches("[0-9]{4}")) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        Path path = dir.resolve(group).resolve(id + ".png").normalize();
        if (!path.startsWith(dir.resolve(group)) || !Files.isRegularFile(path)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_PNG)
                .cacheControl(CacheControl.noStore())
                .body(new FileSystemResource(path));
    }
}
