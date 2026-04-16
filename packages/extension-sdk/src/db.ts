export type OutNode = {
  id: string;
  name: string;
  type: string;
  combo_id: string;
  color: string;
  radius: number;
  display_name: string;
  git_status: string;
  meta_json: string;
};

export type OutEdge = {
  id: string;
  source: string;
  target: string;
  name: string;
  kind: string;
  category: string;
  meta_json: string;
};

export type OutCombo = {
  id: string;
  name: string;
  type: string;
  parent_id: string;
  color: string;
  radius: number;
  display_name: string;
  collapsed: boolean;
  git_status: string;
  meta_json: string;
};

export type OutDetail = {
  id: string;
  file_name: string;
  project_path: string;
  line: number;
  column: number;
  data_json: string;
};
