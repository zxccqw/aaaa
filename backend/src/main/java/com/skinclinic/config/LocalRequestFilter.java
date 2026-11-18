package com.skinclinic.config;

import com.skinclinic.controller.AuthController;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class LocalRequestFilter extends OncePerRequestFilter {
    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS");
    private final String publicOrigin;

    public LocalRequestFilter(@Value("${PUBLIC_ORIGIN:}") String publicOrigin) {
        this.publicOrigin = publicOrigin;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String host = request.getServerName();
        String origin = request.getHeader("Origin");
        String method = request.getMethod();
        boolean allowedOrigin = origin == null || origin.equals(publicOrigin)
                || origin.equals("http://localhost:" + request.getServerPort())
                || origin.equals("http://127.0.0.1:" + request.getServerPort());
        if (!Set.of("127.0.0.1", "localhost").contains(host) || (!SAFE_METHODS.contains(method) && !allowedOrigin)) {
            reject(response, 403, "请求来源无效");
            return;
        }

        response.setHeader("X-Content-Type-Options", "nosniff");
        String path = request.getRequestURI().substring(request.getContextPath().length());
        if (!publicAsset(path, method)) {
            response.setHeader("Cache-Control", "no-store");
            var session = request.getSession(false);
            Object role = session == null ? null : session.getAttribute(AuthController.ROLE);
            boolean login = path.equals("/api/auth/login") && method.equals("POST");
            if (role == null && !login) {
                reject(response, 401, "请先登录");
                return;
            }
            if (("doctor".equals(role) && !doctorAllowed(path, method))
                    || ("admin".equals(role) && (doctorOnly(path, method) || doctorOnly(request.getServletPath(), method)))) {
                reject(response, 403, "当前账号无权访问此功能");
                return;
            }
        }
        chain.doFilter(request, response);
    }

    private boolean publicAsset(String path, String method) {
        return Set.of("GET", "HEAD").contains(method) && Set.of("/", "/index.html", "/login.html",
                "/style.css", "/app.js", "/workspace-pages.js", "/favicon.ico").contains(path);
    }

    private boolean doctorOnly(String path, String method) {
        return path.equals("/api/medical/centers/lab/records")
                || path.equals("/api/medical/analysis")
                || path.equals("/api/medical/segment")
                || path.equals("/api/medical/dataset")
                || path.matches("/api/medical/dataset/[0-9]{4}(/thumb|/mask)?")
                || path.matches("/api/medical/(records|media)/[^/]+")
                || (path.equals("/api/medical/records") && !SAFE_METHODS.contains(method));
    }

    private boolean doctorAllowed(String path, String method) {
        if (path.equals("/api/auth/session") || path.equals("/api/auth/logout") || path.equals("/api/auth/login")) return true;
        if (method.equals("POST")) return path.equals("/api/medical/records") || path.equals("/api/medical/analysis") || path.equals("/api/medical/segment");
        if (method.equals("PUT")) return path.matches("/api/medical/records/[^/]+");
        if (method.equals("DELETE")) return path.matches("/api/medical/records/[^/]+");
        if (!Set.of("GET", "HEAD").contains(method)) return false;
        return path.equals("/api/medical/centers/lab/records") || path.equals("/api/medical/records")
                || path.equals("/api/medical/patients")
                || path.equals("/api/medical/dataset")
                || path.matches("/api/medical/dataset/[0-9]{4}(/thumb|/mask)?")
                || path.matches("/api/medical/(records|media)/[^/]+");
    }

    private void reject(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"error\":\"" + message + "\"}");
    }
}



