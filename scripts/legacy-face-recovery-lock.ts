export function assertLegacyFaceRecoveryLocked(operation: string): never {
  throw new Error(`Operação ${operation} arquivada e bloqueada permanentemente pela Fase 5. Exige nova mudança de código, revisão e aprovação operacional explícita.`);
}
