package com.skinclinic.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.sql.*;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Repository;
import org.springframework.web.server.ResponseStatusException;

@Repository
@ConditionalOnProperty(name = "skin.storage-type", havingValue = "mysql")
public class MySqlInspectionRepository implements InspectionRepository {
    private final ObjectMapper mapper;
    private final String url;
    private final String username;
    private final String password;

    public MySqlInspectionRepository(ObjectMapper mapper,
            @Value("${MYSQL_URL}") String url,
            @Value("${MYSQL_USERNAME}") String username,
            @Value("${MYSQL_PASSWORD}") String password) throws SQLException {
        this.mapper = mapper;
        this.url = url;
        this.username = username;
        this.password = password;
        try (var connection = connect();
             var statement = connection.prepareStatement("SELECT id, version, record_json FROM inspections WHERE 1 = 0");
             var rows = statement.executeQuery()) {
            // Verify the schema at startup, before accepting requests.
        }
    }

    @Override
    public List<ObjectNode> findAll() {
        try (var connection = connect();
             var statement = connection.prepareStatement("SELECT record_json FROM inspections ORDER BY sequence_id");
             var rows = statement.executeQuery()) {
            List<ObjectNode> records = new ArrayList<>();
            while (rows.next()) records.add(readRecord(rows));
            return records;
        } catch (SQLException | IOException e) {
            throw databaseError(e);
        }
    }

    @Override
    public Optional<ObjectNode> findById(String id) {
        try (var connection = connect();
             var statement = connection.prepareStatement("SELECT record_json FROM inspections WHERE id = ?")) {
            statement.setString(1, id);
            try (var rows = statement.executeQuery()) {
                return rows.next() ? Optional.of(readRecord(rows)) : Optional.empty();
            }
        } catch (SQLException | IOException e) {
            throw databaseError(e);
        }
    }

    @Override
    public ObjectNode create(ObjectNode input) {
        var record = input.deepCopy();
        String id = UUID.randomUUID().toString();
        String now = Instant.now().toString();
        record.put("id", id).put("version", 1).put("createdAt", now).put("updatedAt", now);
        try (var connection = connect();
             var statement = connection.prepareStatement(
                     "INSERT INTO inspections (id, version, record_json) VALUES (?, 1, ?)")) {
            statement.setString(1, id);
            statement.setString(2, mapper.writeValueAsString(record));
            statement.executeUpdate();
            return record;
        } catch (SQLException | IOException e) {
            throw databaseError(e);
        }
    }

    @Override
    public ObjectNode update(String id, ObjectNode input, int expectedVersion) {
        var previous = findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "检查不存在"));
        var record = input.deepCopy();
        record.put("id", id).put("version", expectedVersion + 1);
        record.set("createdAt", previous.get("createdAt"));
        record.put("updatedAt", Instant.now().toString());

        try (var connection = connect();
             var statement = connection.prepareStatement(
                     "UPDATE inspections SET version = ?, record_json = ? WHERE id = ? AND version = ?")) {
            statement.setInt(1, expectedVersion + 1);
            statement.setString(2, mapper.writeValueAsString(record));
            statement.setString(3, id);
            statement.setInt(4, expectedVersion);
            if (statement.executeUpdate() == 0) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "记录已修改，请刷新后重试");
            }
            return record;
        } catch (SQLException | IOException e) {
            throw databaseError(e);
        }
    }

    @Override
    public void delete(String id) {
        try (var connection = connect();
             var statement = connection.prepareStatement("DELETE FROM inspections WHERE id = ?")) {
            statement.setString(1, id);
            if (statement.executeUpdate() == 0) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "检查不存在");
            }
        } catch (SQLException e) {
            throw databaseError(e);
        }
    }

    private Connection connect() throws SQLException {
        return DriverManager.getConnection(url, username, password);
    }

    private ObjectNode readRecord(ResultSet rows) throws SQLException, IOException {
        return (ObjectNode) mapper.readTree(rows.getString("record_json"));
    }

    private ResponseStatusException databaseError(Exception cause) {
        return new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "检验数据库操作失败", cause);
    }
}
