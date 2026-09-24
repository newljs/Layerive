// Image size options differ per provider. SenseNova exposes eleven 2K
// constants, while OpenAI's image API accepts only three fixed sizes plus an
// `auto` default. The workspace picker filters this list by the active
// model's provider so users can only choose sizes the provider supports.
export type SizeOption = { value: string; ratio: string; label: string };

export const SENSENOVA_SIZES: SizeOption[] = [
  { value: '1664x2496', ratio: '2:3', label: '竖版' },
  { value: '2496x1664', ratio: '3:2', label: '横版' },
  { value: '1760x2368', ratio: '3:4', label: '竖版' },
  { value: '2368x1760', ratio: '4:3', label: '横版' },
  { value: '1824x2272', ratio: '4:5', label: '竖版' },
  { value: '2272x1824', ratio: '5:4', label: '横版' },
  { value: '2048x2048', ratio: '1:1', label: '方形' },
  { value: '2752x1536', ratio: '16:9', label: '横版' },
  { value: '1536x2752', ratio: '9:16', label: '竖版' },
  { value: '3072x1376', ratio: '21:9', label: '超宽' },
  { value: '1344x3136', ratio: '9:21', label: '超长' },
];

export const OPENAI_SIZES: SizeOption[] = [
  { value: '1024x1024', ratio: '1:1', label: '方形' },
  { value: '1536x1024', ratio: '3:2', label: '横版' },
  { value: '1024x1536', ratio: '2:3', label: '竖版' },
];

export const DEFAULT_SENSENOVA_SIZE = '2048x2048';
export const DEFAULT_OPENAI_SIZE = '1024x1024';

type ModelSizing = { provider?: string; sizeOptions?: string[] } | string | undefined;

function sizeOption(value: string): SizeOption | null {
  const [width, height] = value.split('x').map(Number);
  if (!width || !height) return null;
  const divisor = (left: number, right: number): number => right ? divisor(right, left % right) : left;
  const gcd = divisor(width, height);
  const known = [...SENSENOVA_SIZES, ...OPENAI_SIZES].find((option) => option.value === value);
  return known || { value, ratio: `${width / gcd}:${height / gcd}`, label: '自定义' };
}

function fallbackOptions(model: ModelSizing): SizeOption[] {
  const provider = typeof model === 'string' ? model : model?.provider;
  return provider === 'sensenova' ? SENSENOVA_SIZES : OPENAI_SIZES;
}

export function sizesForProvider(model: ModelSizing): SizeOption[] {
  if (typeof model !== 'string' && Array.isArray(model?.sizeOptions) && model.sizeOptions.length) {
    const options = model.sizeOptions.map(sizeOption).filter((option): option is SizeOption => Boolean(option));
    if (options.length) return options;
  }
  return fallbackOptions(model);
}

export function defaultSizeForProvider(model: ModelSizing): string {
  const configured = sizesForProvider(model)[0]?.value;
  if (configured) return configured;
  return (typeof model === 'string' ? model : model?.provider) === 'sensenova' ? DEFAULT_SENSENOVA_SIZE : DEFAULT_OPENAI_SIZE;
}

export function isValidSizeForProvider(model: ModelSizing, size: string): boolean {
  return sizesForProvider(model).some((option) => option.value === size);
}

// Providers accept a small set of canvas sizes. For uploaded source images,
// choose the option whose aspect ratio is closest on a logarithmic scale so
// portrait and landscape mismatches are penalized symmetrically.
export function closestSizeForDimensions(model: ModelSizing, width: number | null, height: number | null): string {
  if (!width || !height || width <= 0 || height <= 0) return defaultSizeForProvider(model);
  const ratio = width / height;
  return sizesForProvider(model).reduce((closest, option) => {
    const [candidateWidth, candidateHeight] = option.value.split('x').map(Number);
    const closestRatio = Number(closest.split('x')[0]) / Number(closest.split('x')[1]);
    const candidateDistance = Math.abs(Math.log(ratio / (candidateWidth / candidateHeight)));
    const closestDistance = Math.abs(Math.log(ratio / closestRatio));
    return candidateDistance < closestDistance ? option.value : closest;
  }, defaultSizeForProvider(model));
}

// Output format and transparent background are OpenAI-only capabilities.
export const OUTPUT_FORMATS = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number]['value'];
