// Shared operation-mode type definitions used by Step0Credentials and by
// the top-level App component's wizard state. Living in their own module
// so App.tsx can import the types without forcing a static dependency on
// the (lazy-loaded) Step0Credentials component.

export type OperationMode = 'export' | 'migrate';

export type SourceMode = 'api' | 'json' | 'terraform' | 'maxconfig' | 'minconfig';

export type ExportFormat = 'json' | 'everything' | 'terraform';
