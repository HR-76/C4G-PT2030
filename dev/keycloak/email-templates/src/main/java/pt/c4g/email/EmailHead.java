package pt.c4g.email;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "C4G_EMAIL_TEMPLATE_HEAD")
public class EmailHead {
    @Id @Column(name = "REALM_ID", length = 36)
    String realmId;
    @Column(name = "REVISION", nullable = false)
    long revision;
    @Column(name = "VERSION_ID", length = 36, nullable = false)
    String versionId;

    public EmailHead() { }
}
