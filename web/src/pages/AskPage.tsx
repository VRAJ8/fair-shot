import { AskPanel } from '../components/Ask'
import { ChapterHead } from '../components/ui'

export default function AskPage() {
  return (
    <div className="wrap" style={{ paddingTop: 110, maxWidth: 980 }}>
      <ChapterHead quarter="AI analyst · Claude" title="Ask the ledger">
        Ask a question in plain English. Claude writes SQL against the same warehouse that powers this site, runs it
        through a read-only sandbox, and answers from the results. Open "How I got this" under any answer to see the
        exact queries.
      </ChapterHead>
      <AskPanel />
    </div>
  )
}
