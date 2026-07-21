// sql.js không kèm type declaration — khai báo tối giản cho phần ta dùng.
declare module "sql.js" {
  interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, any>;
    free(): boolean;
  }
  interface Database {
    run(sql: string, params?: any[]): void;
    prepare(sql: string): Statement;
    export(): Uint8Array;
  }
  interface SqlJsStatic {
    Database: { new (data?: Uint8Array | Buffer): Database };
  }
  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
