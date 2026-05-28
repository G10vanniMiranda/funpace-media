function baseTemplate(input: { title: string; preview: string; body: string; ctaLabel?: string; ctaUrl?: string }) {
  const cta = input.ctaUrl && input.ctaLabel
    ? `<p style="margin:28px 0;"><a href="${input.ctaUrl}" style="display:inline-block;background:#050505;color:#fff;padding:14px 20px;text-decoration:none;font-weight:800;text-transform:uppercase;letter-spacing:.04em;">${input.ctaLabel}</a></p>`
    : '';

  return `
    <div style="display:none;max-height:0;overflow:hidden;">${input.preview}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:24px 0;font-family:Inter,Arial,sans-serif;color:#050505;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:2px solid #050505;">
            <tr>
              <td style="padding:24px;border-bottom:2px solid #050505;background:#050505;color:#ffffff;">
                <div style="font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#ff4e00;font-weight:800;">Funpace Media</div>
                <h1 style="margin:10px 0 0;font-size:32px;line-height:1;text-transform:uppercase;">${input.title}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;font-size:15px;line-height:1.6;">
                ${input.body}
                ${cta}
                <p style="margin-top:28px;color:#667085;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">Acesse sua conta com o mesmo e-mail da compra para baixar os arquivos.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

export function paidOrderEmailTemplate(input: { buyerName: string; orderShort: string; ordersUrl: string }) {
  return {
    subject: `Pagamento aprovado - pedido #${input.orderShort}`,
    html: baseTemplate({
      title: 'Pagamento aprovado',
      preview: 'Seus downloads Funpace Media ja estao liberados.',
      ctaLabel: 'Acessar meus pedidos',
      ctaUrl: input.ordersUrl,
      body: `
        <p>Ola, <strong>${input.buyerName}</strong>.</p>
        <p>Recebemos a confirmacao do pedido <strong>#${input.orderShort}</strong>. Seus arquivos digitais ja estao liberados na area do cliente.</p>
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
      body: `<p>Ola, <strong>${input.name}</strong>.</p><p>Sua conta esta pronta para acompanhar pedidos, favoritos e downloads.</p>`,
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
      body: `<p>Ola, <strong>${input.buyerName}</strong>.</p><p>Os downloads da sua compra foram liberados com acesso protegido.</p>`,
    }),
  };
}
