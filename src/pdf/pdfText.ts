import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

export type PdfExtractResult = {
  pageTexts: string[]
  fullText: string
}

const MAX_PAGES_CAP = 400

export async function extractPdfText(file: File, opts?: { maxPages?: number }): Promise<PdfExtractResult> {
  const data = await file.arrayBuffer()
  const task = pdfjs.getDocument({ data })
  const doc = await task.promise
  const numPages = doc.numPages
  // Default: all pages (references are usually at the end). Cap for very large PDFs.
  const requested = opts?.maxPages ?? numPages
  const maxPages = Math.max(1, Math.min(requested, numPages, MAX_PAGES_CAP))

  const pageTexts: string[] = []
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const strings = content.items
      .map((it) => ('str' in it ? String((it as { str: unknown }).str) : ''))
      .filter(Boolean)
    pageTexts.push(strings.join(' '))
  }

  const fullText = pageTexts.join('\n\n')
  return { pageTexts, fullText }
}

