package pt.c4g.activation;
import java.util.List;
import org.keycloak.Config;
import org.keycloak.authentication.*;
import org.keycloak.models.*;
import org.keycloak.provider.ProviderConfigProperty;
import jakarta.ws.rs.core.Response;

public final class ManualAuthenticator implements Authenticator, AuthenticatorFactory {
 public void authenticate(AuthenticationFlowContext c) {
  try {
   String ticket=c.getHttpRequest().getUri().getQueryParameters().getFirst("c4g_ticket");
   String subject=Bridge.check(ticket,null,c.getRealm().getName(),c.getAuthenticationSession().getClient().getClientId());
   UserModel user=c.getSession().users().getUserById(c.getRealm(),subject);
   if(user==null || !user.isEnabled() || user.credentialManager().isConfiguredFor("password")) throw new IllegalStateException();
   c.setUser(user); c.getAuthenticationSession().setAuthNote("c4g-manual-ticket",ticket);
   c.getAuthenticationSession().addRequiredAction("c4g-manual-password"); c.success();
  } catch (Exception e) { c.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS,Response.status(403).entity("Ligação indisponível").build()); }
 }
 public void action(AuthenticationFlowContext c){authenticate(c);}
 public boolean requiresUser(){return false;}
 public boolean configuredFor(KeycloakSession s,RealmModel r,UserModel u){return true;}
 public void setRequiredActions(KeycloakSession s,RealmModel r,UserModel u){}
 public Authenticator create(KeycloakSession s){return this;}
 public String getId(){return "c4g-manual-manual";}
 public String getDisplayType(){return "C4G manual activation";}
 public String getReferenceCategory(){return "c4g-proof";}
 public boolean isConfigurable(){return false;}
 public AuthenticationExecutionModel.Requirement[] getRequirementChoices(){return new AuthenticationExecutionModel.Requirement[]{AuthenticationExecutionModel.Requirement.REQUIRED};}
 public boolean isUserSetupAllowed(){return false;}
 public String getHelpText(){return "Invitation-bound C4G activation";}
 public List<ProviderConfigProperty> getConfigProperties(){return List.of();}
 public void init(Config.Scope c){} public void postInit(KeycloakSessionFactory f){} public void close(){}
}
