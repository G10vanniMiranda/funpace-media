import { handleOptions, setCors } from './shared/utils';

export default function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  res.status(200).json({
    ok: true,
    method: req.method,
    time: new Date().toISOString(),
  });
}
