function htmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function baseTemplate(input: {
  title: string;
  preview: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  secondaryCtaLabel?: string;
  secondaryCtaUrl?: string;
}) {
  const cta = input.ctaUrl && input.ctaLabel
    ? `<p style="margin:28px 0 10px;"><a href="${htmlEscape(input.ctaUrl)}" style="display:inline-block;background:#ff4e00;color:#fff;padding:14px 20px;text-decoration:none;font-weight:800;text-transform:uppercase;letter-spacing:.04em;">${htmlEscape(input.ctaLabel)}</a></p>`
    : '';
  const secondaryCta = input.secondaryCtaUrl && input.secondaryCtaLabel
    ? `<p style="margin:10px 0 28px;"><a href="${htmlEscape(input.secondaryCtaUrl)}" style="display:inline-block;background:#050505;color:#fff;padding:14px 20px;text-decoration:none;font-weight:800;text-transform:uppercase;letter-spacing:.04em;">${htmlEscape(input.secondaryCtaLabel)}</a></p>`
    : '';

  return `
    <div style="display:none;max-height:0;overflow:hidden;">${htmlEscape(input.preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:24px 0;font-family:Inter,Arial,sans-serif;color:#050505;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:2px solid #050505;">
            <tr>
              <td style="padding:24px;border-bottom:2px solid #050505;background:#050505;color:#ffffff;">
                <div style="font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#ff4e00;font-weight:800;">Funpace Media</div>
                <h1 style="margin:10px 0 0;font-size:32px;line-height:1;text-transform:uppercase;">${htmlEscape(input.title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;font-size:15px;line-height:1.6;">
                ${input.body}
                ${cta}
                ${secondaryCta}
                <p style="margin-top:28px;color:#667085;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">Links de download sao temporarios e protegidos. Acesse sua conta com o mesmo e-mail da compra para baixar os arquivos.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

export function paidOrderEmailTemplate(input: {
  buyerName: string;
  orderId: string;
  orderShort: string;
  eventName: string;
  itemCount: number;
  total: string;
  ordersUrl: string;
  downloadsUrl: string;
}) {
  return {
    subject: 'Suas fotos da Funpace estao disponiveis',
    html: baseTemplate({
      title: 'Fotos disponiveis',
      preview: 'Recebemos a confirmacao do pagamento e seus downloads estao liberados.',
      ctaLabel: 'Acessar minhas fotos',
      ctaUrl: input.ordersUrl,
      secondaryCtaLabel: 'Baixar arquivos',
      secondaryCtaUrl: input.downloadsUrl,
      body: `
        <p>Ola, <strong>${htmlEscape(input.buyerName)}</strong>.</p>
        <p>Recebemos a confirmacao do seu pagamento e suas fotos ja estao disponiveis para download.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;border:1px solid #e5e7eb;">
          <tr><td style="padding:10px 12px;color:#667085;font-size:12px;text-transform:uppercase;">Pedido</td><td style="padding:10px 12px;font-weight:800;">#${htmlEscape(input.orderShort)}</td></tr>
          <tr><td style="padding:10px 12px;color:#667085;font-size:12px;text-transform:uppercase;">Evento</td><td style="padding:10px 12px;font-weight:800;">${htmlEscape(input.eventName)}</td></tr>
          <tr><td style="padding:10px 12px;color:#667085;font-size:12px;text-transform:uppercase;">Itens</td><td style="padding:10px 12px;font-weight:800;">${htmlEscape(input.itemCount)}</td></tr>
          <tr><td style="padding:10px 12px;color:#667085;font-size:12px;text-transform:uppercase;">Valor</td><td style="padding:10px 12px;font-weight:800;">${htmlEscape(input.total)}</td></tr>
        </table>
        <p style="color:#667085;font-size:13px;">Por seguranca, este e-mail nao contem URL publica permanente dos arquivos originais. Os links temporarios sao gerados no painel e expiram automaticamente.</p>
      `,
    }),
  };
}

export function welcomeEmailTemplate(input: { name: string; accountUrl: string }) {
  return {
    subject: 'Bem-vindo a Funpace Media',
    html: baseTemplate({
      title: 'Conta criada',
      preview: 'Sua conta Funpace Media esta pronta.',
      ctaLabel: 'Abrir minha conta',
      ctaUrl: input.accountUrl,
      body: `<p>Ola, <strong>${htmlEscape(input.name)}</strong>.</p><p>Sua conta esta pronta para acompanhar pedidos, favoritos e downloads.</p>`,
    }),
  };
}

export function passwordRecoveryTemplate(input: { recoveryUrl: string }) {
  return {
    subject: 'Recuperacao de senha',
    html: baseTemplate({
      title: 'Recuperar senha',
      preview: 'Use o link para definir uma nova senha.',
      ctaLabel: 'Definir nova senha',
      ctaUrl: input.recoveryUrl,
      body: '<p>Recebemos uma solicitacao para recuperar sua senha. Use o botao abaixo para continuar.</p>',
    }),
  };
}

export function downloadReleasedTemplate(input: { buyerName: string; ordersUrl: string }) {
  return {
    subject: 'Downloads liberados',
    html: baseTemplate({
      title: 'Downloads liberados',
      preview: 'Suas fotos digitais ja podem ser baixadas.',
      ctaLabel: 'Baixar fotos',
      ctaUrl: input.ordersUrl,
      body: `<p>Ola, <strong>${htmlEscape(input.buyerName)}</strong>.</p><p>Os downloads da sua compra foram liberados com acesso protegido.</p>`,
    }),
  };
}
