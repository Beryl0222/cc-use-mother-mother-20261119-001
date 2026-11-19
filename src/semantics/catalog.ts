export interface MetricDefinition {
  id: string;
  label: string;
  aliases: string[];
  defaultUnit: string | null;
  family: 'capacity' | 'count' | 'growth' | 'rank' | 'demand';
}

export const METRICS: MetricDefinition[] = [
  { id: 'intelligent_compute_scale', label: '智能算力规模', aliases: ['智能算力规模', '智能算力'], defaultUnit: 'EFLOPS', family: 'capacity' },
  { id: 'aggregated_compute_resources', label: '汇聚算力资源', aliases: ['汇聚资源', '汇聚算力资源'], defaultUnit: 'EFLOPS', family: 'capacity' },
  { id: 'compute_network_channels', label: '算力传输通道数量', aliases: ['算力传输通道', '算力大通道', '传输通道'], defaultUnit: '条', family: 'count' },
  { id: 'compute_identifiers', label: '算力标识数量', aliases: ['算力标识', '标识数量'], defaultUnit: '条', family: 'count' },
  { id: 'token_call_volume', label: '词元调用量', aliases: ['词元调用量', 'Token调用量', 'token调用量'], defaultUnit: null, family: 'demand' },
  { id: 'growth_rate', label: '同比变化率', aliases: ['同比增长', '同比上升', '同比下降', '同比减少'], defaultUnit: '%', family: 'growth' },
  { id: 'national_rank', label: '全国位次', aliases: ['全国第一方阵', '全国第二', '稳居世界第二', '位居全国第一'], defaultUnit: '位次', family: 'rank' },
  { id: 'compute_vouchers', label: '算力券申领情况', aliases: ['算力券申领', '算力券'], defaultUnit: null, family: 'demand' },
];

export function findMetric(text: string): MetricDefinition | null {
  const matches = METRICS.flatMap((metric) => metric.aliases
    .filter((alias) => text.includes(alias))
    .map((alias) => ({ metric, alias })))
    .sort((left, right) => right.alias.length - left.alias.length);
  return matches[0]?.metric ?? null;
}

export function metricById(id: string): MetricDefinition | null {
  return METRICS.find((metric) => metric.id === id) ?? null;
}

export function canonicalUnit(unit: string | null): string | null {
  if (!unit) return null;
  const value = unit.replace(/每秒进行百亿亿次浮点运算/gu, 'EFLOPS').replace(/词元/gu, 'token');
  if (/EFLOPS/i.test(value)) return 'EFLOPS';
  if (/万条|亿条|千条|条/u.test(value)) return '条';
  if (/%|百分比/u.test(value)) return '%';
  if (/位次|排名|第[一二三四五六七八九十]+/u.test(value)) return '位次';
  return value.trim() || null;
}
