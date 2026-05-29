import { ArrowLeft, Mail, MessageCircle, Send, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Footer } from '../components/Footer';
import { Navbar } from '../components/Navbar';

export function Contato() {
  const navigate = useNavigate();

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
            className="font-mono text-xs md:text-sm tracking-widest uppercase text-gray-500 hover:text-brutal-accent transition-colors mb-8 flex items-center gap-2"
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
                Envie sua duvida sobre compra, pagamento, download, cadastro de fotografo ou publicacao de eventos.
              </p>

              <form
                onSubmit={(event) => event.preventDefault()}
                className="mt-8 grid gap-4"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-gray-500">Nome</span>
                    <input
                      type="text"
                      className="h-14 w-full bg-gray-50 brutal-border px-4 font-mono text-sm outline-none focus:bg-white"
                      placeholder="Seu nome"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-gray-500">Email</span>
                    <input
                      type="email"
                      className="h-14 w-full bg-gray-50 brutal-border px-4 font-mono text-sm outline-none focus:bg-white"
                      placeholder="voce@email.com"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-gray-500">Assunto</span>
                  <select className="h-14 w-full bg-gray-50 brutal-border px-4 font-mono text-sm uppercase outline-none focus:bg-white">
                    <option>Compra ou pagamento</option>
                    <option>Download de midia</option>
                    <option>Cadastro de fotografo</option>
                    <option>Publicacao de evento</option>
                    <option>Outro assunto</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-gray-500">Mensagem</span>
                  <textarea
                    className="min-h-36 w-full resize-y bg-gray-50 brutal-border p-4 font-mono text-sm outline-none focus:bg-white"
                    placeholder="Descreva o que aconteceu..."
                  />
                </label>

                <button
                  type="submit"
                  className="min-h-14 bg-brutal-black text-white brutal-border brutal-shadow-hover font-display text-sm md:text-base uppercase tracking-widest inline-flex items-center justify-center gap-2 px-6"
                >
                  <Send className="w-5 h-5" />
                  Enviar mensagem
                </button>
              </form>
            </div>

            <aside className="space-y-5">
              {[
                {
                  icon: Mail,
                  title: 'Email',
                  text: 'Atendimento para compras, pagamentos e suporte geral.',
                  action: 'contato@funpace.media',
                },
                {
                  icon: MessageCircle,
                  title: 'Compradores',
                  text: 'Informe o email da compra e o pedido, se tiver.',
                  action: 'Minha Conta',
                },
                {
                  icon: UserRound,
                  title: 'Fotografos',
                  text: 'Para envio, cadastro e vendas, acesse o painel.',
                  action: 'Painel do Fotografo',
                },
              ].map((item) => (
                <article key={item.title} className="bg-white brutal-border brutal-shadow-hover p-6">
                  <div className="mb-5 inline-flex bg-brutal-accent text-white brutal-border p-3">
                    <item.icon className="w-6 h-6" />
                  </div>
                  <h2 className="font-display text-2xl uppercase tracking-normal mb-2">{item.title}</h2>
                  <p className="font-mono text-xs uppercase leading-relaxed text-gray-600 mb-4">{item.text}</p>
                  <p className="font-mono text-xs uppercase tracking-widest text-brutal-accent font-bold">{item.action}</p>
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
