<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
<#if section == "header">Verificação adicional por email
<#elseif section == "form">
<div class="c4g-email-check">
  <p class="email-status" role="status">${messageText}</p>
  <p>Destino: <strong>${maskedEmail}</strong><br>Validade do código: ${ttlSeconds} segundos.</p>
  <form action="${url.loginAction}" method="post">
    <label for="email-code">Código recebido por email</label>
    <input id="email-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required>
    <button type="submit" class="email-confirm">${purposeLabel}</button>
    <div class="email-actions">
      <button type="submit" name="resend" value="1" formnovalidate>Reenviar código</button>
      <button type="submit" name="cancel" value="1" formnovalidate>Cancelar</button>
    </div>
  </form>
  <p>Intervalo até ao próximo reenvio: ${resendSeconds} segundos.</p>
  <p>Se perdeu o acesso ao email, contacte o apoio para conhecer as opções de recuperação.</p>
</div>
</#if>
</@layout.registrationLayout>
