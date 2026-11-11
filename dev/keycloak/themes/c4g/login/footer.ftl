<#macro content>
  <#if (pageId!'') == 'login' && !realm.resetPasswordAllowed>
    <details class="c4g-recovery-help">
      <summary>Esqueci-me da palavra-passe</summary>
      <p>A recuperação por email ainda não está disponível neste ambiente. Se não conseguir entrar, contacte a administração C4G. Não partilhe a sua palavra-passe.</p>
    </details>
  </#if>
  <aside class="c4g-login-story" aria-label="C4G Funding Platform">
    <div class="c4g-login-story-content">
      <div class="c4g-funding-orbit" aria-hidden="true">
        <span class="c4g-orbit-ring c4g-orbit-ring-outer"></span>
        <span class="c4g-orbit-ring c4g-orbit-ring-middle"></span>
        <span class="c4g-orbit-ring c4g-orbit-ring-inner"></span>
        <span class="c4g-orbit-axis c4g-orbit-axis-horizontal"></span>
        <span class="c4g-orbit-axis c4g-orbit-axis-vertical"></span>
        <span class="c4g-orbit-label c4g-orbit-label-catalog">Catálogo central</span>
        <span class="c4g-orbit-label c4g-orbit-label-matching">Matching explicável</span>
        <span class="c4g-orbit-label c4g-orbit-label-applications">Candidaturas</span>
        <span class="c4g-orbit-label c4g-orbit-label-team">Equipa e prazos</span>
        <span class="c4g-orbit-core">
          <span>C4G</span>
          <strong>Financiamento</strong>
          <small>em movimento</small>
        </span>
      </div>
      <div class="c4g-login-story-copy">
        <h2>Encontre financiamento.<br>Faça avançar os seus projetos.</h2>
        <p class="c4g-login-description">Descubra oportunidades, qualifique a sua relevância e acompanhe cada candidatura num único lugar.</p>
      </div>
    </div>
    <p class="c4g-login-signature">C4G — Consulting and Training Network</p>
  </aside>
</#macro>
