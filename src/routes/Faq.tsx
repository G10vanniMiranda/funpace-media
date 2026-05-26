import { ArrowLeft, HelpCircle, ShoppingBag, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Footer } from '../components/Footer';
import { Navbar } from '../components/Navbar';

const buyerQuestions = [
  {
    question: 'Como encontro minhas fotos?',
    answer: 'Escolha o evento na vitrine e navegue pelas fotos publicadas. Quando a busca facial estiver ativa, voce tambem podera enviar uma selfie para localizar imagens relacionadas.',
  },
  {
    question: 'Quando o download fica liberado?',
    answer: 'Depois que a InfinitePay confirma o pagamento, o pedido aparece como pago em Minhas Compras e os arquivos ficam liberados.',
  },
  {
    question: 'Posso comprar fotos de eventos diferentes?',
    answer: 'Sim. O carrinho aceita midias publicadas na plataforma. Antes do pagamento, confira os itens e o valor total no checkout.',
  },
];

const photographerQuestions = [
  {
    question: 'Como viro fotografo parceiro?',
    answer: 'Crie sua conta, solicite acesso como fotografo e aguarde a aprovacao do admin. Depois disso, o painel de publicacao fica disponivel.',
  },
  {
    question: 'Como publico uma cobertura?',
    answer: 'No painel do fotografo, envie as midias e preencha evento, ponto, numero de peito quando aplicavel e preco.',
  },
  {
    question: 'Como recebo pelas vendas?',
    answer: 'As vendas pagas aparecem no painel. O saque e solicitado via Pix, respeitando as regras de saldo disponivel da plataforma.',
  },
];

export function Faq() {
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
        <section className="max-w-[1400px] mx-auto py-10 md:py-16">
          <button
            onClick={() => navigate('/')}
            className="font-mono text-xs md:text-sm tracking-widest uppercase text-gray-500 hover:text-brutal-accent transition-colors mb-8 flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para loja
          </button>

          <div className="bg-white brutal-border brutal-shadow p-6 md:p-10 mb-8">
            <p className="font-mono text-[10px] md:text-xs uppercase tracking-[0.3em] text-brutal-accent font-bold mb-3">
              Suporte
            </p>
            <h1 className="font-display text-[clamp(2.8rem,9vw,6rem)] uppercase leading-[0.9] tracking-normal">
              Duvidas frequentes
            </h1>
            <p className="mt-6 max-w-2xl font-mono text-sm md:text-base uppercase leading-relaxed text-gray-600">
              Respostas rapidas para quem compra fotos e para fotografos que publicam coberturas na Funpace.
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <FaqGroup
              icon={ShoppingBag}
              title="Compradores"
              questions={buyerQuestions}
            />
            <FaqGroup
              icon={UserRound}
              title="Fotografos"
              questions={photographerQuestions}
            />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function FaqGroup({
  icon: Icon,
  title,
  questions,
}: {
  icon: typeof ShoppingBag;
  title: string;
  questions: { question: string; answer: string }[];
}) {
  return (
    <section className="bg-white brutal-border brutal-shadow p-5 md:p-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="bg-brutal-accent text-white brutal-border p-3">
          <Icon className="w-6 h-6" />
        </div>
        <h2 className="font-display text-3xl uppercase tracking-normal">{title}</h2>
      </div>

      <div className="space-y-4">
        {questions.map((item) => (
          <article key={item.question} className="bg-gray-50 brutal-border p-5">
            <div className="flex items-start gap-3">
              <HelpCircle className="w-5 h-5 text-brutal-accent shrink-0 mt-1" />
              <div>
                <h3 className="font-display text-lg uppercase tracking-normal">{item.question}</h3>
                <p className="mt-2 font-mono text-xs uppercase leading-relaxed text-gray-600">{item.answer}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
