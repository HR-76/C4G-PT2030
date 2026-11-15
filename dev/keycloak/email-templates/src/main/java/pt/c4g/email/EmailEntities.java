package pt.c4g.email;

import java.util.List;
import org.keycloak.Config;
import org.keycloak.connections.jpa.entityprovider.JpaEntityProvider;
import org.keycloak.connections.jpa.entityprovider.JpaEntityProviderFactory;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

public final class EmailEntities implements JpaEntityProviderFactory {
    public static final String ID = "c4g-email-template-entities";
    @Override public String getId() { return ID; }
    @Override public void init(Config.Scope config) { }
    @Override public void postInit(KeycloakSessionFactory factory) { }
    @Override public void close() { }
    @Override public JpaEntityProvider create(KeycloakSession session) {
        return new JpaEntityProvider() {
            @Override public List<Class<?>> getEntities() { return List.of(EmailHead.class, EmailVersion.class); }
            @Override public String getChangelogLocation() { return "META-INF/c4g-email-templates.xml"; }
            @Override public String getFactoryId() { return ID; }
            @Override public void close() { }
        };
    }
}
