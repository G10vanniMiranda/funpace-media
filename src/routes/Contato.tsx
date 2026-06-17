import { ArrowLeft, MessageCircle, Send, UserRound } from 'lucide-react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Footer } from '../components/Footer';
import { Navbar } from '../components/Navbar';
import { FUNPACE_WHATSAPP_DISPLAY, buildWhatsappUrl } from '../lib/contact';

export function Contato() {
  const navigate = useNavigate();
  const handleContactSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get('name') || '').trim();
    const email = String(formData.get('email') || '').trim();
    const subject = String(formData.get('subject') || 'Contato Funpace').trim();
    const message = String(formData.get('message') || '').trim();
    const whatsappMessage = [
      `Contato Funpace - ${subject}`,
      '',
      name ? `Nome: ${name}` : '',
      email ? `Email: ${email}` : '',
      '',
      message,
    ].filter(Boolean).join('\n');

    window.location.href = buildWhatsappUrl(whatsappMessage);
  };

  return (
    <div className="min-h-screen bg-brutal-white text-brutal-black">
      <Navbar
        cartItemCount={0}
        onOpenCart={() => navigate('/checkout')}
        onNavigateHome={() => navigate('/')}
        onOpenAuth={() => navigate('/')}
        onSearch={() => navigate('/')}
        onOpenDashboard={() => navigate('/fotografo')}
        onOpenOrders={() => navigate('/')}
      />

      <main className="px-4 md:px-6">
        <section className="max-w-[1400px] mx-auto py-10 md:py-16">
          <button
            onClick={() => navigate('/')}
            className="premium-button font-mono text-xs md:text-sm tracking-widest uppercase text-gray-500 hover:text-brutal-accent transition-colors mb-8 flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para loja
          </button>

          <div className="grid gap-8 lg:grid-cols-[1fr_420px] lg:items-start">
            <div className="bg-white brutal-border brutal-shadow p-6 md:p-10">
              <p className="font-mono text-[10px] md:text-xs uppercase tracking-[0.3em] text-brutal-accent font-bold mb-3">
                Fale conosco
              </p>
              <h1 className="font-display text-[clamp(2.8rem,9vw,6rem)] uppercase leading-[0.9] tracking-normal">
                Precisa de ajuda?
              </h1>
              <p className="mt-6 max-w-2xl font-mono text-sm md:text-base uppercase leading-relaxed text-gray-600">
                Envie sua dúvida sobre compra, pagamento, download, cadastro de fotógrafo ou publicação de eventos.
              </p>

              <form
                onSubmit={handleContactSubmit}
                className="mt-8 grid gap-4"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-gray-500">Nome</span>
                    <input
                      type="text"
                      name="name"
                      className="premium-input h-14 w-full bg-gray-50 brutal-border px-4 font-mono text-sm outline-none focus:bg-white"
                      placeholder="Seu nome"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-gray-500">Email</span>
                    <input
                      type="email"
                      name="email"
                      className="premium-input h-14 w-full bg-gray-50 brutal-border px-4 font-mono text-sm outline-none focus:bg-white"
                      placeholder="voce@email.com"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-gray-500">Assunto</span>
                  <select name="subject" className="premium-input h-14 w-full bg-gray-50 brutal-border px-4 font-mono text-sm uppercase outline-none focus:bg-white">
                    <option>Compra ou pagamento</option>
                    <option>Download de mídia</option>
                    <option>Cadastro de fotógrafo</option>
                    <option>Publicação de evento</option>
                    <option>Outro assunto</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-gray-500">Mensagem</span>
                  <textarea
                    name="message"
                    className="premium-input min-h-36 w-full resize-y bg-gray-50 brutal-border p-4 font-mono text-sm outline-none focus:bg-white"
                    placeholder="Descreva o que aconteceu..."
                  />
                </label>

                <button
                  type="submit"
                  className="premium-button min-h-14 bg-brutal-black text-white brutal-border font-display text-sm md:text-base uppercase tracking-widest inline-flex items-center justify-center gap-2 px-6"
                >
                  <Send className="w-5 h-5" />
                  Enviar mensagem
                </button>
              </form>
            </div>

            <aside className="space-y-5">
              {[
                {
                  icon: MessageCircle,
                  title: 'WhatsApp',
                  text: 'Atendimento para compras, pagamentos e suporte geral.',
                  action: FUNPACE_WHATSAPP_DISPLAY,
                  href: buildWhatsappUrl('Olá, Funpace. Preciso de atendimento.'),
                },
                {
                  icon: MessageCircle,
                  title: 'Compradores',
                  text: 'Informe o e-mail da compra e o pedido, se tiver.',
                  action: 'Minha Conta',
                  href: '',
                },
                {
                  icon: UserRound,
                  title: 'Fotógrafos',
                  text: 'Para envio, cadastro e vendas, acesse o painel.',
                  action: 'Painel do Fotógrafo',
                  href: '',
                },
              ].map((item) => (
                <article key={item.title} className="premium-card bg-white brutal-border p-6">
                  <div className="mb-5 inline-flex bg-brutal-accent text-white brutal-border p-3">
                    <item.icon className="w-6 h-6" />
                  </div>
                  <h2 className="font-display text-2xl uppercase tracking-normal mb-2">{item.title}</h2>
                  <p className="font-mono text-xs uppercase leading-relaxed text-gray-600 mb-4">{item.text}</p>
                  {item.href ? (
                    <a href={item.href} className="font-mono text-xs uppercase tracking-widest text-brutal-accent font-bold hover:underline">
                      {item.action}
                    </a>
                  ) : (
                    <p className="font-mono text-xs uppercase tracking-widest text-brutal-accent font-bold">{item.action}</p>
                  )}
                </article>
              ))}
            </aside>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
