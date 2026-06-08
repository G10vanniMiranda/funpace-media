import { Instagram, Mail } from 'lucide-react';
import { buildMailtoUrl, buildWhatsappUrl } from '../lib/contact';

export function Footer() {
  return (
    <footer className="border-t-4 border-brutal-black bg-brutal-white pt-12 md:pt-20 pb-10 px-4 md:px-6 mt-12">
      <div className="max-w-350 mx-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-12 mb-16">
        <div className="sm:col-span-2">
          <h3 className="font-display text-3xl md:text-4xl mb-4 text-brutal-black">FUNPACE MEDIA</h3>
          <p className="font-mono text-sm text-gray-600 max-w-sm mb-6">
            O marketplace do corredor. Encontre, compre e reviva suas memórias de corrida. Feito para a comunidade, movido pelo ritmo.
          </p>
          <div className="flex gap-4">
            <a
              href="https://www.instagram.com/fun__pace/?__pwa=1#"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram da Funpace Media"
              className="w-12 h-12 bg-brutal-black text-white flex items-center justify-center brutal-border hover:bg-brutal-accent transition-colors brutal-shadow cursor-pointer"
            >
              <Instagram className="w-5 h-5" />
            </a>
            <a
              href={buildMailtoUrl({ subject: 'Contato Funpace' })}
              aria-label="E-mail da Funpace Media"
              className="w-12 h-12 bg-brutal-black text-white flex items-center justify-center brutal-border hover:bg-brutal-accent transition-colors brutal-shadow cursor-pointer"
            >
              <Mail className="w-5 h-5" />
            </a>
          </div>
        </div>

        <div>
          <h4 className="font-mono font-bold uppercase tracking-widest mb-6">Links Rápidos</h4>
          <ul className="space-y-4 font-mono text-sm uppercase">
            <li><a href="/" className="hover:text-brutal-accent transition-colors">Buscar Fotos</a></li>
            <li><a href="/eventos" className="hover:text-brutal-accent transition-colors">Eventos Recentes</a></li>
            <li><a href="/para-fotografos" className="hover:text-brutal-accent transition-colors">Para Fotógrafos</a></li>
            <li><a href="/precos" className="hover:text-brutal-accent transition-colors">Preços</a></li>
          </ul>
        </div>

        <div>
          <h4 className="font-mono font-bold uppercase tracking-widest mb-6">Suporte</h4>
          <ul className="space-y-4 font-mono text-sm uppercase">
            <li><a href="/faq" className="hover:text-brutal-accent transition-colors">Dúvidas Frequentes</a></li>
            <li><a href={buildWhatsappUrl('Olá, Funpace. Preciso de atendimento.')} target="_blank" rel="noopener noreferrer" className="hover:text-brutal-accent transition-colors">Fale Conosco</a></li>
            <li><a href="/termos" className="hover:text-brutal-accent transition-colors">Termos de Serviço</a></li>
            <li><a href="/privacidade" className="hover:text-brutal-accent transition-colors">Política de Privacidade</a></li>
          </ul>
        </div>
      </div>

      <div className="max-w-350 mx-auto pt-8 border-t-2 border-dashed border-gray-300 flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="font-mono text-xs uppercase text-gray-500">
          © {new Date().getFullYear()} FUNPACE MEDIA. Todos os direitos reservados.
        </p>
        <div className="font-mono text-xs uppercase text-gray-500 flex items-center gap-2">
          <span>Ultrapasse.</span>
          <span className="text-brutal-accent font-bold">Nunca Olhe Para Trás.</span>
        </div>
      </div>
    </footer>
  );
}
