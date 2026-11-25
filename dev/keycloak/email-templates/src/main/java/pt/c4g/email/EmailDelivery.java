package pt.c4g.email;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.util.Objects;

/** Minimal transport evidence; no identity ID, message, token or provider error. */
@Entity
@Table(name = "C4G_EMAIL_DELIVERY")
@IdClass(EmailDelivery.Key.class)
public class EmailDelivery {
    @Id @Column(name = "ID", length = 36) public String id;
    @Id @Column(name = "REALM_ID", length = 36) public String realmId;
    @Column(name = "OCCURRED_AT", nullable = false) public long occurredAt;
    @Column(name = "RECIPIENT", length = 254) public String recipient;
    @Column(name = "RESULT", length = 16, nullable = false) public String result;
    public EmailDelivery() { }
    public static class Key implements Serializable {
        public String id;
        public String realmId;
        public Key() { }
        public Key(String id, String realmId) { this.id = id; this.realmId = realmId; }
        @Override public boolean equals(Object other) {
            return other instanceof Key key && Objects.equals(id, key.id) && Objects.equals(realmId, key.realmId);
        }
        @Override public int hashCode() { return Objects.hash(id, realmId); }
    }
}
