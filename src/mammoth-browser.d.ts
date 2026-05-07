declare module 'mammoth/mammoth.browser' {
  interface ConvertToHtmlResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  const mammoth: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<ConvertToHtmlResult>;
  };

  export default mammoth;
}
