package pt.c4g.activation;
import java.lang.reflect.*;
import org.keycloak.authentication.*;
import org.keycloak.authentication.requiredactions.UpdatePassword;
import org.keycloak.models.KeycloakSession;

// Delegate password validation/storage to native Keycloak. Recheck the invitation at each step.
public final class ManualPassword extends UpdatePassword {
 private boolean valid(RequiredActionContext c) {
  try { return Bridge.check(c.getAuthenticationSession().getAuthNote("c4g-manual-ticket"),c.getUser().getId(),c.getRealm().getName(),c.getAuthenticationSession().getClient().getClientId()).equals(c.getUser().getId()); }
  catch(Exception e){c.failure("INVITATION_UNAVAILABLE");return false;}
 }
 @Override public void evaluateTriggers(RequiredActionContext c){}
 @Override public void requiredActionChallenge(RequiredActionContext c){if(valid(c))super.requiredActionChallenge(c);}
 @Override public void processAction(RequiredActionContext c){
  if(!valid(c))return;
  RequiredActionContext guarded=(RequiredActionContext)Proxy.newProxyInstance(RequiredActionContext.class.getClassLoader(),new Class[]{RequiredActionContext.class},(proxy,method,args)->{
   if(method.getName().equals("success") && !valid(c)){c.getSession().getTransactionManager().setRollbackOnly();return null;}
   try{return method.invoke(c,args);}catch(InvocationTargetException e){throw e.getCause();}
  });
  super.processAction(guarded);
 }
 @Override public String getId(){return "c4g-manual-password";}
 @Override public String getDisplayText(){return "Definir password C4G";}
 @Override public RequiredActionProvider create(KeycloakSession s){return new ManualPassword();}
}
