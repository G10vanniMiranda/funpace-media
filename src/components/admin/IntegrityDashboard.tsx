import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import type { IntegrityDashboardSnapshot } from '../../types';
import { adminService } from '../../lib/services';

const metricCards = [
  ['integrity_health_percent', 'Saúde', '%'],
  ['integrity_critical_findings', 'Críticos', ''],
  ['face_processing_stuck', 'Processing preso', ''],
  ['review_queue_pending', 'Revisão pendente', ''],
  ['face_pending', 'Faces pendentes', ''],
  ['aws_orphan_faces', 'Órfãs na AWS', ''],
] as const;

function dateTime(value?: string | null) {
  return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '—';
}

function MetricCard({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className="border border-white/10 bg-[#0d131c] p-5">
      <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value || 0)}{suffix}</p>
    </div>
  );
}

export function IntegrityDashboard() {
  const [data, setData] = useState<IntegrityDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setData(await adminService.getIntegrityDashboard());
      setError('');
    } catch (cause: any) {
      setError(cause?.message || 'Não foi possível carregar a integridade.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (reconcile: boolean) => {
    setRunning(true);
    setError('');
    try {
      await adminService.runIntegrityScan(reconcile);
      await refresh(true);
    } catch (cause: any) {
      setError(cause?.message || 'Falha ao executar auditoria.');
    } finally {
      setRunning(false);
    }
  };

  const review = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await adminService.updateIntegrityReview(id, status);
      await refresh(true);
    } catch (cause: any) {
      setError(cause?.message || 'Falha ao registrar decisão.');
    }
  };

  if (loading && !data) return <div className="p-10 text-center font-mono text-sm text-gray-400">Carregando integridade…</div>;

  const health = Number(data?.metrics.integrity_health_percent || 0);
  const healthy = health >= 99.9 && Number(data?.metrics.integrity_critical_findings || 0) === 0;
  const pending = (data?.reviewQueue || []).filter((item) => item.status === 'pending');

  return (
    <div className="space-y-6">
      {error && <div className="border border-red-500/60 bg-red-500/10 p-4 font-mono text-sm text-red-200">{error}</div>}

      <section className="border border-white/10 bg-[#0d131c] p-6 flex flex-col xl:flex-row gap-5 xl:items-center xl:justify-between">
        <div className="flex items-start gap-4">
          <div className={`p-3 border ${healthy ? 'border-green-500/40 bg-green-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
            {healthy ? <ShieldCheck className="text-green-400" /> : <AlertTriangle className="text-amber-400" />}
          </div>
          <div>
            <h3 className="text-xl font-black">{healthy ? 'Integridade saudável' : 'Integridade requer atenção'}</h3>
            <p className="mt-1 font-mono text-xs text-gray-400">Última auditoria: {dateTime(data?.latestRun?.completed_at || data?.latestRun?.started_at)}</p>
            <p className="mt-1 font-mono text-xs text-gray-500">Atualização automática do painel a cada 30 segundos.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => void refresh()} disabled={loading || running} className="border border-white/15 px-4 py-3 font-mono text-xs uppercase hover:bg-white/10 disabled:opacity-50">
            <RefreshCw className="inline w-4 h-4 mr-2" />Atualizar
          </button>
          <button onClick={() => void run(false)} disabled={running} className="bg-white text-black px-4 py-3 font-mono text-xs font-bold uppercase disabled:opacity-50">
            <Activity className="inline w-4 h-4 mr-2" />{running ? 'Auditando…' : 'Executar auditoria'}
          </button>
          {data?.configuration.autoReconcileEnabled && (
            <button onClick={() => void run(true)} disabled={running} className="bg-brutal-accent px-4 py-3 font-mono text-xs font-bold uppercase disabled:opacity-50">Reconciliar elegíveis</button>
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        {metricCards.map(([key, label, suffix]) => <MetricCard key={key} label={label} value={Number(data?.metrics[key] || 0)} suffix={suffix} />)}
      </div>

      <section className="grid xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 border border-white/10 bg-[#0d131c] overflow-hidden">
          <div className="p-5 border-b border-white/10 flex items-center justify-between">
            <h3 className="font-black">Fila de revisão humana</h3>
            <span className="font-mono text-xs text-gray-400">{pending.length} pendente(s)</span>
          </div>
          <div className="max-h-[420px] overflow-auto divide-y divide-white/10">
            {pending.slice(0, 100).map((item) => (
              <div key={item.id} className="p-4 flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex gap-2 items-center">
                    <AlertTriangle className={`w-4 h-4 ${item.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />
                    <span className="font-mono text-xs uppercase">{item.category}</span>
                    <span className="font-mono text-[10px] text-gray-500">{Number(item.confidence || 0).toFixed(1)}%</span>
                  </div>
                  <p className="mt-2 truncate font-mono text-[11px] text-gray-500">{item.entity_type}: {item.entity_id || 'sem ID'}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => void review(item.id, 'approved')} className="border border-green-500/40 px-3 py-2 text-green-300 font-mono text-[10px] uppercase"><CheckCircle2 className="inline w-3 h-3 mr-1" />Aprovar</button>
                  <button onClick={() => void review(item.id, 'rejected')} className="border border-red-500/40 px-3 py-2 text-red-300 font-mono text-[10px] uppercase"><XCircle className="inline w-3 h-3 mr-1" />Rejeitar</button>
                </div>
              </div>
            ))}
            {!pending.length && <p className="p-8 text-center font-mono text-xs text-gray-500">Nenhum item aguardando revisão.</p>}
          </div>
        </div>

        <div className="border border-white/10 bg-[#0d131c] p-5 space-y-4">
          <h3 className="font-black">Operação</h3>
          <div className="space-y-3 font-mono text-xs text-gray-400">
            <p><Clock className="inline w-4 h-4 mr-2" />Intervalo: {data?.configuration.intervalMinutes || 0} min</p>
            <p>Scheduler: <span className={data?.configuration.schedulerEnabled ? 'text-green-400' : 'text-gray-500'}>{data?.configuration.schedulerEnabled ? 'ativo' : 'inativo'}</span></p>
            <p>Reconciliação: <span className={data?.configuration.autoReconcileEnabled ? 'text-green-400' : 'text-gray-500'}>{data?.configuration.autoReconcileEnabled ? 'ativa' : 'bloqueada'}</span></p>
            <p>Confiança mínima: {data?.configuration.minimumAutoConfidence || 99.9}%</p>
            <p>Data de corte: {dateTime(data?.configuration.autoReconcileCutoff)}</p>
          </div>
          <div className="pt-4 border-t border-white/10">
            <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">Alertas recentes</p>
            <p className="mt-2 text-2xl font-black">{data?.alerts?.length || 0}</p>
          </div>
          <div className="pt-4 border-t border-white/10">
            <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">Correções auditadas</p>
            <p className="mt-2 text-2xl font-black">{data?.corrections?.length || 0}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
