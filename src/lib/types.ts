export type Source = {
  id?: string;
  source?: string;
  title?: string;
  company?: string;
  doc_type?: string;
  published_date?: string;
  page_start?: number;
  page_end?: number;
  chunk_index?: number;
};

export type ChartSpec = {
  type?: "line" | "bar" | "scatter" | "pie";
  labels: string[];
  series: { name: string; values: number[]; color?: string }[];
  unit?: string;
  stacked?: boolean;
};

export type AnswerResponse = {
  answer: string;
  sources: Source[];
  chartSpec?: ChartSpec | null;
};
