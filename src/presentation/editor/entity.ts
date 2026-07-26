import type { CommandResult } from "../../application/game-application";
import type { Page, PageQuery, SortDirection } from "../../application/ports/catalog";
import type { Html } from "../app/html";
import type { IconName } from "../app/icons";

export interface Column<TRow> {
  readonly label: string;
  /**
   * Campo indexado por onde a coluna ordena. Sem ele a coluna não é clicável — é o caso do
   * que vem de outra entidade, como a camisa, que mora no contrato e o banco não cruza.
   */
  readonly sort?: string;
  /**
   * Inverte a direção pedida. Idade cresce quando o ano de nascimento diminui, e quem lê o
   * cabeçalho espera "crescente" no sentido da coluna, não no do campo gravado.
   */
  readonly invert?: boolean;
  /** Trilha na grade da tabela, em sintaxe de `grid-template-columns`. */
  readonly width: string;
  readonly align?: "end";
  readonly render: (row: TRow) => Html;
}

export interface BindContext<TDraft> {
  readonly panel: HTMLElement;
  /**
   * Função, e não valor: `bind` roda na montagem, antes de existir rascunho, e os handlers que
   * ele pendura disparam depois. Um getter resolveria igual, mas seria silenciosamente anulado
   * por quem desestruturasse o contexto — a função não deixa cair nessa.
   */
  readonly draft: () => TDraft;
  /** Repinta só este painel a partir do rascunho, preservando o que já foi digitado. */
  readonly refresh: () => void;
}

export interface CollectContext<TDraft> {
  readonly panel: HTMLElement;
  readonly draft: TDraft;
  readonly data: FormData;
}

export interface EntityTab<TDraft> {
  readonly id: string;
  readonly label: string;
  render(draft: TDraft): Html;
  /**
   * Liga os eventos do painel. Roda uma vez por montagem, então os handlers precisam ser
   * delegados: `refresh` reescreve a marcação interna e levaria embora qualquer listener
   * pendurado direto no campo.
   */
  bind?(context: BindContext<TDraft>): void;
  /** Lê os campos do painel para dentro do rascunho. Roda antes de salvar e antes de repintar. */
  collect?(context: CollectContext<TDraft>): void;
}

/**
 * Tudo que o editor precisa saber sobre uma entidade. A tabela e o modal não conhecem nenhuma:
 * acrescentar Estádio ou Competição é acrescentar um descritor, e nada mais.
 */
export interface EntityDescriptor<TRow, TDraft> {
  readonly id: string;
  readonly label: string;
  /** No singular, para os títulos do modal ("Novo clube"). */
  readonly singular: string;
  readonly icon: IconName;
  readonly columns: readonly Column<TRow>[];
  readonly defaultSort: { field: string; direction: SortDirection };
  /** Campo de busca por prefixo. Ausente: a entidade não tem caixa de busca. */
  readonly searchField?: string;
  readonly searchPlaceholder?: string;

  /** Carrega a página já pronta para exibir. É aqui que a junção com outras entidades mora. */
  page(query: PageQuery): Promise<Page<TRow>>;
  /** Abre o rascunho: uma cópia da entidade, ou uma em branco quando `id` é nulo. */
  draft(id: string | null): Promise<TDraft>;
  readonly tabs: readonly EntityTab<TDraft>[];
  save(draft: TDraft): Promise<CommandResult>;
  remove(id: string): Promise<CommandResult>;
  /** Rótulo da linha, para as confirmações e os textos de acessibilidade. */
  labelOf(row: TRow): string;
  idOf(row: TRow): string;
}
