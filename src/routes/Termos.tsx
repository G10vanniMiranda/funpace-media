import { ArrowLeft, FileText, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Footer } from '../components/Footer';
import { Navbar } from '../components/Navbar';

const sections = [
  {
    title: 'Uso da plataforma',
    text: 'A Funpace Media conecta compradores e fotógrafos para venda de mídias digitais de eventos esportivos. O usuário deve usar a plataforma de forma lícita e fornecer dados corretos no cadastro e checkout.',
  },
  {
    title: 'Compra e liberação',
    text: 'Os arquivos digitais são liberados após a confirmação do pagamento pelo provedor. Pedidos pendentes podem levar alguns instantes para atualizar automaticamente.',
  },
  {
    title: 'Direitos das mídias',
    text: 'As fotos e vídeos publicados pertencem aos fotógrafos ou responsáveis pela cobertura. A compra concede acesso ao download pessoal, sem transferência de autoria.',
  },
  {
    title: 'Responsabilidade do fotógrafo',
    text: 'O fotógrafo parceiro é responsável pela origem, qualidade, classificação e informações das mídias publicadas, incluindo evento, ponto, preço e dados de venda.',
  },
  {
    title: 'Alterações',
    text: 'Estes termos podem ser atualizados para refletir mudanças operacionais, legais ou de produto. A versão publicada nesta página é a referência vigente.',
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
              Termos de serviço
            </h1>
            <p className="mt-6 max-w-2xl font-mono text-sm md:text-base uppercase leading-relaxed text-gray-600">
              Regras gerais de uso da Funpace Media para compradores, fotógrafos e visitantes.
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
