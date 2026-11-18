package com.skinclinic.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.ConnectException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Semaphore;

/** Proxy to the local SkinFusion-Seg HTTP service (FastAPI on 127.0.0.1:8000). */
@Service
public class SkinFusionService {
    private final ObjectMapper mapper;
    private final String url;
    private final String apiKey;
    private final Path media;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final Semaphore slots = new Semaphore(1);

    public SkinFusionService(ObjectMapper mapper,
                             @Value("${skinfusion.url:http://127.0.0.1:8000}") String url,
                             @Value("${skinfusion.api-key:}") String apiKey,
                             @Value("${skin.storage}") String directory) throws IOException {
        this.mapper = mapper;
        this.url = url.replaceAll("/+$", "");
        this.apiKey = apiKey;
        this.media = Path.of(directory).toAbsolutePath().normalize().resolve("media");
        Files.createDirectories(media);
    }

    public String url() {
        return url;
    }

    public Map<String, Object> segment(MultipartFile upload) {
        if (upload == null || upload.isEmpty() || upload.getSize() > 10L * 1024 * 1024) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请选择10MB以内的PNG/JPEG图片");
        }
        if (!slots.tryAcquire()) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "AI分割服务繁忙，请稍后重试");
        }
        try {
            byte[] png = toPng(upload);
            String dataUrl = "data:image/png;base64," + Base64.getEncoder().encodeToString(png);
            ObjectNode body = mapper.createObjectNode().put("image_base64", dataUrl).put("include_overlay", true);
            HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url + "/v1/segment"))
                    .timeout(Duration.ofSeconds(120))
                    .header("Content-Type", "application/json");
            if (!apiKey.isBlank()) builder.header("X-API-Key", apiKey);
            HttpRequest request = builder.POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body))).build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, upstreamError(response));
            }
            JsonNode result = mapper.readTree(response.body());
            String mask = result.path("mask_png_base64").asText("");
            String overlay = result.path("overlay_png_base64").asText("");
            if (mask.isBlank() || overlay.isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "AI分割服务未返回完整结果");
            }
            String id = UUID.randomUUID().toString();
            Path maskFile = media.resolve(id + "-mask.png");
            Path overlayFile = media.resolve(id + "-overlay.png");
            Files.write(maskFile, Base64.getDecoder().decode(mask));
            Files.write(overlayFile, Base64.getDecoder().decode(overlay));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", id);
            out.put("model", result.path("model").asText("SkinFusion-Seg"));
            out.put("version", result.path("version").asText(""));
            out.put("width", result.path("width").asInt());
            out.put("height", result.path("height").asInt());
            out.put("threshold", result.path("threshold").asDouble(0.5));
            out.put("lesionAreaRatio", result.path("lesion_area_ratio").asDouble());
            out.put("inferenceMs", result.path("inference_ms").asDouble());
            out.put("maskImageUrl", "/api/medical/media/" + maskFile.getFileName());
            out.put("overlayImageUrl", "/api/medical/media/" + overlayFile.getFileName());
            out.put("savedAt", Instant.now().toString());
            return out;
        } catch (ResponseStatusException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "AI分割请求已中断");
        } catch (HttpTimeoutException e) {
            throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT, "AI分割超时，请重试");
        } catch (ConnectException e) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "AI分割服务未启动，请先启动 SkinFusion-Seg（端口8000）");
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "AI分割服务调用失败：" + e.getMessage());
        } finally {
            slots.release();
        }
    }

    private byte[] toPng(MultipartFile upload) throws IOException {
        BufferedImage image;
        try (var stream = ImageIO.createImageInputStream(new ByteArrayInputStream(upload.getBytes()))) {
            var readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "无法解码图片，请上传PNG/JPEG");
            var reader = readers.next();
            try {
                reader.setInput(stream);
                String format = reader.getFormatName().toLowerCase(Locale.ROOT);
                int width = reader.getWidth(0), height = reader.getHeight(0);
                if (!Set.of("png", "jpeg", "jpg").contains(format)) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "只支持PNG/JPEG图片");
                }
                if (width > 8192 || height > 8192 || (long) width * height > 4_000_000L) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "图片不得超过400万像素");
                }
                image = reader.read(0);
            } finally {
                reader.dispose();
            }
        }
        var out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    private String upstreamError(HttpResponse<String> response) {
        try {
            JsonNode detail = mapper.readTree(response.body()).path("detail");
            if (detail.isTextual() && !detail.asText().isBlank()) {
                return "AI分割服务返回：" + detail.asText();
            }
        } catch (Exception ignored) {
        }
        return "AI分割服务返回 HTTP " + response.statusCode();
    }

    public Path image(String filename) {
        if (!filename.matches("[a-f0-9-]{36}-(mask|overlay)\\.png")) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        Path path = media.resolve(filename).normalize();
        if (!path.startsWith(media) || !Files.isRegularFile(path)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return path;
    }
}
