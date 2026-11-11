package pt.c4g.proof;
import java.util.List;
import org.keycloak.Config;
import org.keycloak.authentication.*;
import org.keycloak.models.*;
import org.keycloak.provider.ProviderConfigProperty;
import jakarta.ws.rs.core.Response;

public final class ManualAuthenticator implements Authenticator, AuthenticatorFactory {
 public void authenticate(AuthenticationFlowContext c) {
  try {
   if (!c.getRealm().getName().equals("c4g-manual-proof")) throw new IllegalStateException();
   String ticket=c.getHttpRequest().getUri().getQueryParameters().getFirst("c4g_ticket");
   String subject=Bridge.check(ticket,null);
   UserModel user=c.getSession().users().getUserById(c.getRealm(),subject);
   if(user==null || !user.isEnabled() || user.credentialManager().isConfiguredFor("password")) throw new IllegalStateException();
   c.setUser(user); c.getAuthenticationSession().setAuthNote("c4g-proof-ticket",ticket);
   c.getAuthenticationSession().addRequiredAction("c4g-proof-password"); c.success();
  } catch (Exception e) { c.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS,Response.status(403).entity("Ligação indisponível").build()); }
 }
 public void action(AuthenticationFlowContext c){authenticate(c);}
 public boolean requiresUser(){return false;}
 public boolean configuredFor(KeycloakSession s,RealmModel r,UserModel u){return true;}
 public void setRequiredActions(KeycloakSession s,RealmModel r,UserModel u){}
 public Authenticator create(KeycloakSession s){return this;}
 public String getId(){return "c4g-proof-manual";}
 public String getDisplayType(){return "C4G disposable manual activation";}
 public String getReferenceCategory(){return "c4g-proof";}
 public boolean isConfigurable(){return false;}
 public AuthenticationExecutionModel.Requirement[] getRequirementChoices(){return new AuthenticationExecutionModel.Requirement[]{AuthenticationExecutionModel.Requirement.REQUIRED};}
 public boolean isUserSetupAllowed(){return false;}
 public String getHelpText(){return "Isolated feasibility proof only";}
 public List<ProviderConfigProperty> getConfigProperties(){return List.of();}
 public void init(Config.Scope c){} public void postInit(KeycloakSessionFactory f){} public void close(){}
}
