package com.skinclinic.repository;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Optional;
/** Database extension point for a future JDBC/JPA adapter. */
public interface InspectionRepository {
 List<ObjectNode> findAll();
 Optional<ObjectNode> findById(String id);
 ObjectNode create(ObjectNode record);
 ObjectNode update(String id,ObjectNode record,int expectedVersion);
 void delete(String id);
}
