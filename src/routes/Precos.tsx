import { ArrowLeft, BadgeDollarSign, Camera, CreditCard, Percent, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Footer } from '../components/Footer';
import { Navbar } from '../components/Navbar';

export function Precos() {
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
                Preços
              </p>
              <h1 className="font-display text-[clamp(2.8rem,9vw,6rem)] uppercase leading-[0.9] tracking-normal">
                Regras claras para vender e comprar
              </h1>
              <p className="mt-6 max-w-2xl font-mono text-sm md:text-base uppercase leading-relaxed text-gray-600">
                A Funpace organiza a venda digital por evento. O fotógrafo define o preço da mídia e acompanha as vendas confirmadas no painel.
              </p>
            </div>

            <aside className="bg-brutal-black text-white brutal-border brutal-shadow p-6 md:p-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gray-400 mb-4">
                Resumo
              </p>
              <div className="space-y-5">
                {[
                  { icon: BadgeDollarSign, label: 'Preço da mídia', value: 'Definido pelo fotógrafo' },
                  { icon: Percent, label: 'Comissão', value: 'Configurada pelo administrador' },
                  { icon: Wallet, label: 'Saque', value: 'Solicitado via Pix' },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-4 border-t border-white/10 pt-5 first:border-t-0 first:pt-0">
                    <div className="shrink-0 bg-brutal-accent text-white brutal-border-thin p-2">
                      <item.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">{item.label}</p>
                      <p className="font-display text-lg uppercase tracking-normal">{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {[
              {
                icon: Camera,
                title: 'Para compradores',
                text: 'O valor final aparece antes do checkout. Depois do pagamento confirmado, os arquivos ficam liberados em Minha Conta.',
              },
              {
                icon: CreditCard,
                title: 'Pagamento',
                text: 'Os pagamentos são processados pela InfinitePay. A liberação automática acontece após a confirmação do provedor.',
              },
              {
                icon: Wallet,
                title: 'Para fotógrafos',
                text: 'As vendas pagas entram no painel do fotógrafo. O saldo disponível considera comissão e regras de liberação da plataforma.',
              },
            ].map((item) => (
              <article key={item.title} className="bg-white brutal-border brutal-shadow-hover p-6">
                <div className="mb-5 inline-flex bg-brutal-accent text-white brutal-border p-3">
                  <item.icon className="w-6 h-6" />
                </div>
                <h2 className="font-display text-2xl uppercase tracking-normal mb-3">{item.title}</h2>
                <p className="font-mono text-xs uppercase leading-relaxed text-gray-600">{item.text}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
