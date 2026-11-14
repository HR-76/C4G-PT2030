// Development only: an in-memory stand-in for the email template API, used by
// email-preview.html to look at the screen before the backend exists. It is not
// imported by the application. Its sanitization approximates the server's and
// is not a security boundary.

const ALLOWED = ['P', 'BR', 'H1', 'H2', 'H3', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'A']
const DROP_WITH_CONTENT = ['SCRIPT', 'STYLE', 'TEXTAREA', 'OPTION']
const VARIABLES = { body: ['Organizacao', 'LigacaoAtivacao', 'Validade', 'Logotipo'], subject: ['Organizacao', 'Validade'], required: ['LigacaoAtivacao', 'Validade'] }
const DEFAULT = {
  subject: 'Ative o seu acesso à C4G',
  html: '<p>{Logotipo}</p><p>Foi-lhe atribuído acesso à plataforma C4G.</p><p>Abra a ligação para ativar o acesso e definir a sua palavra-passe. Se já tem conta, entre com a sua palavra-passe atual.</p><p><a href="{LigacaoAtivacao}">Ativar acesso</a></p><p>Esta ligação é de uso único e expira em {Validade}.</p>',
}
const ENTITIES = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Associação Exemplo A' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Instituto Exemplo B' },
]

const reply = data => Promise.resolve({ data: structuredClone(data) })
const refuse = (status, code, extra = {}) => Promise.reject({ response: { status, data: { error: { code, ...extra } } } })
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function sanitize(input) {
  const removed = new Set()
  const root = new DOMParser().parseFromString(`<div>${input}</div>`, 'text/html').body.firstChild
  const clean = node => {
    for (const child of [...node.children]) {
      if (DROP_WITH_CONTENT.includes(child.tagName)) { removed.add(child.tagName.toLowerCase()); child.remove(); continue }
      clean(child)
      if (!ALLOWED.includes(child.tagName)) { removed.add(child.tagName.toLowerCase()); child.replaceWith(...child.childNodes); continue }
      for (const attribute of [...child.attributes]) {
        const href = child.tagName === 'A' && attribute.name === 'href'
        if (href && (attribute.value === '{LigacaoAtivacao}' || /^https:\/\/[^@\s]+$/i.test(attribute.value))) continue
        removed.add(href ? 'a[href]' : `${child.tagName.toLowerCase()}[${attribute.name}]`)
        child.removeAttribute(attribute.name)
      }
    }
  }
  clean(root)
  return { html: root.innerHTML.trim(), removed: [...removed].sort() }
}

function validate({ subject = '', html = '' }) {
  const reasons = [], cleaned = sanitize(html)
  if (!subject.trim()) reasons.push({ code: 'SUBJECT_REQUIRED' })
  for (const [, name] of cleaned.html.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) if (!VARIABLES.body.includes(name)) reasons.push({ code: 'UNKNOWN_VARIABLE', variable: name })
  for (const [, name] of subject.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) if (!VARIABLES.subject.includes(name)) reasons.push({ code: VARIABLES.body.includes(name) ? 'VARIABLE_NOT_ALLOWED_IN_SUBJECT' : 'UNKNOWN_VARIABLE', variable: name })
  for (const name of VARIABLES.required) if (!cleaned.html.includes(`{${name}}`)) reasons.push({ code: 'REQUIRED_VARIABLE_MISSING', variable: name })
  return { reasons, subject: subject.trim(), ...cleaned }
}

function textOf(html) {
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstChild
  root.querySelectorAll('a[href]').forEach(link => { link.textContent = `${link.textContent}: ${link.getAttribute('href')}` })
  root.querySelectorAll('li').forEach(item => { item.textContent = `- ${item.textContent}\n` })
  root.querySelectorAll('p,h1,h2,h3,ul,ol').forEach(block => block.append('\n\n'))
  root.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
  return root.textContent.replace(/\n{3,}/g, '\n\n').trim()
}

export function createEmailSimulation({ user = 'admin@example.invalid' } = {}) {
  const saved = new Map(), logo = { url: null, revision: 0 }
  const revisions = new Map()
  const organizationName = scope => ENTITIES.find(entity => entity.id === scope)?.name
  const view = scope => {
    const own = saved.get(scope || 'GLOBAL'), global = saved.get('GLOBAL')
    const current = own || (scope && global) || DEFAULT
    return {
      type: 'member-invitation',
      source: own ? (scope ? 'ORGANIZATION' : 'GLOBAL') : scope && global ? 'GLOBAL' : 'DEFAULT',
      subject: current.subject, html: current.html,
      revision: revisions.get(scope || 'GLOBAL') || 0,
      updatedAt: current.updatedAt || null, updatedBy: current.updatedBy || null,
      variables: VARIABLES,
      logo: { source: 'C4G', url: logo.url },
    }
  }
  const known = scope => !scope || organizationName(scope)
  const bump = scope => revisions.set(scope || 'GLOBAL', (revisions.get(scope || 'GLOBAL') || 0) + 1)

  const api = {
    types: () => reply({ items: [{ type: 'member-invitation' }] }),
    template: (type, scope) => known(scope) ? reply(view(scope)) : refuse(404, 'RESOURCE_NOT_AVAILABLE'),
    save: (type, scope, body) => {
      const checked = validate(body)
      if (checked.reasons.length) return refuse(400, 'EMAIL_TEMPLATE_INVALID', { reasons: checked.reasons })
      if (body.expectedRevision !== (revisions.get(scope || 'GLOBAL') || 0)) return refuse(409, 'STALE_REVISION')
      saved.set(scope || 'GLOBAL', { subject: checked.subject, html: checked.html, updatedAt: new Date().toISOString(), updatedBy: user })
      bump(scope)
      return reply({ ...view(scope), removed: checked.removed })
    },
    reset: (type, scope) => { saved.delete(scope || 'GLOBAL'); bump(scope); return reply(view(scope)) },
    preview: (type, scope, body) => {
      const checked = validate(body)
      const organization = organizationName(scope) || 'Entidade de exemplo'
      const expiry = '13 de novembro de 2026 às 14:30 (hora de Lisboa)', link = 'https://exemplo.invalid/ativacao-de-exemplo'
      const fill = (value, image) => value.replaceAll('{Organizacao}', escapeHtml(organization)).replaceAll('{Validade}', expiry).replaceAll('{LigacaoAtivacao}', link).replaceAll('{Logotipo}', image)
      const image = `<img src="${logo.url || '/logo-c4g.png'}" alt="" style="max-width:240px;height:auto;border:0">`
      return reply({
        subject: fill(checked.subject, ''),
        html: `<!doctype html><html lang="pt"><body style="font-family:Arial,sans-serif;color:#10251c">${fill(checked.html, image)}</body></html>`,
        text: fill(textOf(checked.html), ''),
        removed: checked.removed,
      })
    },
    test: (type, scope, body) => {
      const checked = validate(body)
      if (checked.reasons.length) return refuse(400, 'EMAIL_TEMPLATE_INVALID', { reasons: checked.reasons })
      return reply({ status: 'ACCEPTED', to: user })
    },
    logo: () => reply(logo),
    // A data URL, because the page's content policy only allows same-origin and data images.
    logoWrite: file => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => { logo.url = reader.result; logo.revision += 1; resolve(reply(logo)) }
      reader.onerror = () => reject(new Error('read failed'))
      reader.readAsDataURL(file)
    }),
    logoRemove: () => { logo.url = null; logo.revision += 1; return reply(logo) },
  }
  const directoryApi = {
    entities: ({ q = '' } = {}) => reply({ items: ENTITIES.filter(entity => entity.name.toLowerCase().includes(q.toLowerCase())) }),
  }
  return { api, directoryApi }
}
