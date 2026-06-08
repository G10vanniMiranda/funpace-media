import { ArrowLeft, Camera, CheckCircle2, Upload, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Footer } from '../components/Footer';
import { Navbar } from '../components/Navbar';

export function ParaFotografos() {
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
                Para fotógrafos
              </p>
              <h1 className="font-display text-[clamp(2.8rem,9vw,6rem)] uppercase leading-[0.9] tracking-normal">
                Venda suas fotos de corrida
              </h1>
              <p className="mt-6 max-w-2xl font-mono text-sm md:text-base uppercase leading-relaxed text-gray-600">
                Publique suas coberturas, organize por evento e deixe a Funpace cuidar da vitrine, pagamento e acesso do comprador.
              </p>
              <button
                onClick={() => navigate('/fotografo')}
                className="mt-8 min-h-14 px-6 bg-brutal-accent text-white brutal-border brutal-shadow-hover font-display text-sm md:text-base uppercase tracking-widest inline-flex items-center justify-center gap-2"
              >
                <Camera className="w-5 h-5" />
                Acessar painel
              </button>
            </div>

            <aside className="bg-brutal-black text-white brutal-border brutal-shadow p-6 md:p-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gray-400 mb-4">
                Fluxo do fotógrafo
              </p>
              <div className="space-y-5">
                {[
                  { icon: CheckCircle2, title: 'Cadastro aprovado', text: 'Solicite acesso e aguarde a validação do administrador.' },
                  { icon: Upload, title: 'Envie as mídias', text: 'Publique fotos e vídeos com evento, ponto e preço.' },
                  { icon: Wallet, title: 'Receba pelas vendas', text: 'Acompanhe pedidos pagos e solicite saque Pix.' },
                ].map((item) => (
                  <div key={item.title} className="flex gap-4 border-t border-white/10 pt-5 first:border-t-0 first:pt-0">
                    <div className="shrink-0 bg-brutal-accent text-white brutal-border-thin p-2">
                      <item.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-display text-lg uppercase tracking-normal">{item.title}</h2>
                      <p className="mt-1 font-mono text-xs uppercase leading-relaxed text-gray-400">{item.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
