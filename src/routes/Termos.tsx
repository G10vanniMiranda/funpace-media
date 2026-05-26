import { ArrowLeft, FileText, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Footer } from '../components/Footer';
import { Navbar } from '../components/Navbar';

const sections = [
  {
    title: 'Uso da plataforma',
    text: 'A Funpace Media conecta compradores e fotografos para venda de midias digitais de eventos esportivos. O usuario deve usar a plataforma de forma licita e fornecer dados corretos no cadastro e checkout.',
  },
  {
    title: 'Compra e liberacao',
    text: 'Os arquivos digitais sao liberados apos confirmacao do pagamento pelo provedor. Pedidos pendentes podem levar alguns instantes para atualizar automaticamente.',
  },
  {
    title: 'Direitos das midias',
    text: 'As fotos e videos publicados pertencem aos fotografos ou responsaveis pela cobertura. A compra concede acesso ao download pessoal, sem transferencia de autoria.',
  },
  {
    title: 'Responsabilidade do fotografo',
    text: 'O fotografo parceiro e responsavel pela origem, qualidade, classificacao e informacoes das midias publicadas, incluindo evento, ponto, preco e dados de venda.',
  },
  {
    title: 'Alteracoes',
    text: 'Estes termos podem ser atualizados para refletir mudancas operacionais, legais ou de produto. A versao publicada nesta pagina e a referencia vigente.',
  },
];

export function Termos() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-brutal-white text-brutal-black">
      <Navbar
        cartItemCount={0}
        onOpenCart={() => navigate('/checkout')}
        onNavigateHome={() => navigate('/')}
        onOpenAuth={() => navigate('/')}
        onSearch={() => navigate('/')}
        onSelfieSearch={() => navigate('/')}
        onOpenDashboard={() => navigate('/fotografo')}
        onOpenOrders={() => navigate('/')}
      />

      <main className="px-4 md:px-6">
        <section className="max-w-[1100px] mx-auto py-10 md:py-16">
          <button
            onClick={() => navigate('/')}
            className="font-mono text-xs md:text-sm tracking-widest uppercase text-gray-500 hover:text-brutal-accent transition-colors mb-8 flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para loja
          </button>

          <div className="bg-white brutal-border brutal-shadow p-6 md:p-10 mb-8">
            <p className="font-mono text-[10px] md:text-xs uppercase tracking-[0.3em] text-brutal-accent font-bold mb-3">
              Legal
            </p>
            <h1 className="font-display text-[clamp(2.8rem,9vw,6rem)] uppercase leading-[0.9] tracking-normal">
              Termos de servico
            </h1>
            <p className="mt-6 max-w-2xl font-mono text-sm md:text-base uppercase leading-relaxed text-gray-600">
              Regras gerais de uso da Funpace Media para compradores, fotografos e visitantes.
            </p>
          </div>

          <div className="grid gap-5">
            {sections.map((section, index) => (
              <article key={section.title} className="bg-white brutal-border p-5 md:p-6">
                <div className="flex items-start gap-4">
                  <div className="bg-brutal-accent text-white brutal-border p-3 shrink-0">
                    {index === 0 ? <ShieldCheck className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                  </div>
                  <div>
                    <h2 className="font-display text-2xl uppercase tracking-normal">{section.title}</h2>
                    <p className="mt-3 font-mono text-xs md:text-sm uppercase leading-relaxed text-gray-600">{section.text}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
