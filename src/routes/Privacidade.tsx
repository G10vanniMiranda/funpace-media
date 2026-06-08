import { ArrowLeft, Database, Eye, Lock, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Footer } from '../components/Footer';
import { Navbar } from '../components/Navbar';

const sections = [
  {
    icon: Database,
    title: 'Dados coletados',
    text: 'Podemos coletar dados de conta, contato, compra, pagamento, eventos acessados e informações necessárias para liberar downloads e operar o marketplace.',
  },
  {
    icon: Eye,
    title: 'Uso das informações',
    text: 'Os dados são usados para autenticar usuários, processar pedidos, liberar arquivos, apoiar fotógrafos, melhorar a experiência e responder solicitações de suporte.',
  },
  {
    icon: Lock,
    title: 'Proteção e acesso',
    text: 'A plataforma usa controles de acesso para restringir informações sensíveis. Arquivos digitais podem usar URLs assinadas ou regras de permissão conforme a configuração.',
  },
  {
    icon: Shield,
    title: 'Privacidade em mídias',
    text: 'Fotos e vídeos são publicados por fotógrafos parceiros. Caso exista uma solicitação relacionada à imagem, entre em contato informando evento e detalhes da mídia.',
  },
];

export function Privacidade() {
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
              Política de privacidade
            </h1>
            <p className="mt-6 max-w-2xl font-mono text-sm md:text-base uppercase leading-relaxed text-gray-600">
              Como a Funpace Media trata dados de compradores, fotógrafos e visitantes durante o uso da plataforma.
            </p>
          </div>

          <div className="grid gap-5">
            {sections.map((section) => (
              <article key={section.title} className="bg-white brutal-border p-5 md:p-6">
                <div className="flex items-start gap-4">
                  <div className="bg-brutal-accent text-white brutal-border p-3 shrink-0">
                    <section.icon className="w-5 h-5" />
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
