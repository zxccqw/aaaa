package com.skinclinic.controller;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    public static final String ROLE = "authenticatedRole";
    private final Account doctor;
    private final Account admin;

    public AuthController(Environment env) {
        doctor = account(env, "DOCTOR", "doctor");
        admin = account(env, "ADMIN", "admin");
        if (doctor.enabled() && admin.enabled()
                && (doctor.matchesName(admin.name()) || doctor.matchesName(admin.email())
                    || doctor.password().equals(admin.password()))) {
            throw new IllegalStateException("医生与管理员须使用不同的账号和密码");
        }
    }

    private static Account account(Environment env, String prefix, String role) {
        return new Account(env.getProperty(prefix + "_USERNAME", "").strip(),
                env.getProperty(prefix + "_EMAIL", "").strip(),
                env.getProperty(prefix + "_PASSWORD", ""), role);
    }

    @PostMapping("/login")
    public Map<String, String> login(@RequestBody Credentials credentials, HttpServletRequest request) {
        String name = credentials.account() == null ? "" : credentials.account().strip();
        String password = credentials.password();
        if (name.length() > 254 || password == null || password.length() > 1024) {
            throw invalidCredentials();
        }
        Account account = admin.accepts(name, password) ? admin : doctor.accepts(name, password) ? doctor : null;
        if (account == null) throw invalidCredentials();
        var oldSession = request.getSession(false);
        if (oldSession != null) oldSession.invalidate();
        request.getSession(true).setAttribute(ROLE, account.role());
        return Map.of("role", account.role());
    }

    @GetMapping("/session")
    public Map<String, String> session(HttpServletRequest request) {
        var session = request.getSession(false);
        if (session == null || !(session.getAttribute(ROLE) instanceof String role)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "请先登录");
        }
        return Map.of("role", role);
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest request) {
        var session = request.getSession(false);
        if (session != null) session.invalidate();
    }

    private static ResponseStatusException invalidCredentials() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "账号或密码错误");
    }

    public record Credentials(String account, String password) {}

    private record Account(String name, String email, String password, String role) {
        boolean enabled() {
            return (!name.isBlank() || !email.isBlank()) && !password.isBlank();
        }
        boolean matchesName(String input) {
            return !input.isBlank() && (name.equalsIgnoreCase(input) || email.equalsIgnoreCase(input));
        }
        boolean accepts(String input, String candidate) {
            return enabled() && matchesName(input) && MessageDigest.isEqual(
                    password.getBytes(StandardCharsets.UTF_8), candidate.getBytes(StandardCharsets.UTF_8));
        }
    }
}
