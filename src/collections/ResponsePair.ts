export class ResponsePair<R, E> {
  readonly response: R;
  readonly errorBody: E | null;

  constructor(response: R, errorBody: E | null) {
    this.response = response;
    this.errorBody = errorBody;
  }

  isError(): boolean {
    return this.errorBody !== null;
  }
}
