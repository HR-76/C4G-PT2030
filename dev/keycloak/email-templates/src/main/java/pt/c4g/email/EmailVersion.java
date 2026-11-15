package pt.c4g.email;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.Immutable;
import org.hibernate.annotations.Nationalized;

/** An append-only publication receipt; never contains an actual recovery link. */
@Entity
@Immutable
@Table(name = "C4G_EMAIL_TEMPLATE_VERSION")
public class EmailVersion {
    @Id @Column(name = "ID", length = 36)
    String id;
    @Column(name = "REALM_ID", length = 36, nullable = false)
    String realmId;
    @Column(name = "REVISION", nullable = false)
    long revision;
    @Column(name = "REQUEST_ID", length = 36, nullable = false)
    String requestId;
    @Column(name = "REQUEST_SHA256", length = 64, nullable = false)
    String requestSha256;
    @Column(name = "ACTOR_ID", length = 36, nullable = false)
    String actorId;
    @Column(name = "CREATED_AT", nullable = false)
    long createdAt;
    @Nationalized @Column(name = "PAYLOAD_JSON", nullable = false)
    String payloadJson;
    @Nationalized @Column(name = "LOCALES_JSON", nullable = false)
    String localesJson;

    public EmailVersion() { }
}
