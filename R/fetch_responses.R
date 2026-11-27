# Fetch survey responses from your private GitHub repo into a data frame.
#
# Setup (one time):
#   install.packages(c("gh", "jsonlite"))
#   Set GITHUB_PAT in ~/.Renviron to a fine-grained token with
#   Contents: read-only on the private responses repo.
#
# Usage:
#   source("R/fetch_responses.R")
#   df <- fetch_responses("k3f9x2ab")
#   meeting_tally(df, "q1_ab12")   # availability counts per date/time

library(gh)
library(jsonlite)

SURVEY_OWNER <- "asgr"
SURVEY_PRIVATE_REPO <- "survey-responses"
SURVEY_PUBLIC_REPO <- "Shiny-Survey"

# Survey definition (public), used for question labels and meeting slots.
fetch_definition <- function(survey_id,
                             owner = SURVEY_OWNER,
                             public_repo = SURVEY_PUBLIC_REPO) {
  url <- sprintf(
    "https://raw.githubusercontent.com/%s/%s/main/docs/surveys/%s.json",
    owner, public_repo, survey_id
  )
  jsonlite::fromJSON(url, simplifyVector = FALSE)
}

# One row per respondent. Choice/text/rating questions become columns named
# by question id; multi-choice is collapsed with "; "; meeting grids become
# one column per slot, named "<question id>: <slot>".
fetch_responses <- function(survey_id,
                            owner = SURVEY_OWNER,
                            repo = SURVEY_PRIVATE_REPO) {
  path <- sprintf("responses/%s", survey_id)
  files <- tryCatch(
    gh::gh("GET /repos/{owner}/{repo}/contents/{path}",
           owner = owner, repo = repo, path = path, .limit = Inf),
    error = function(e) {
      if (grepl("404", conditionMessage(e))) return(list())
      stop(e)
    }
  )
  # Skip "ip-" dedup markers; they contain no answers.
  files <- Filter(
    function(f) identical(f$type, "file") && !startsWith(f$name, "ip-"),
    files
  )
  if (length(files) == 0) {
    message("No responses yet for survey ", survey_id)
    return(data.frame())
  }

  records <- lapply(files, function(f) {
    # Contents API returns base64 for files < 1 MB; plenty for one response.
    item <- gh::gh("GET /repos/{owner}/{repo}/contents/{path}",
                   owner = owner, repo = repo, path = f$path)
    jsonlite::fromJSON(rawToChar(base64enc_decode(item$content)),
                       simplifyVector = FALSE)
  })

  records_to_df(records)
}

# Pure parsing step, separated from the network code so it can be tested
# on locally saved response JSON.
records_to_df <- function(records) {
  rows <- lapply(records, function(r) {
    row <- list(
      submitted_at = r$submittedAt,
      name = r$name %||% NA_character_
    )
    for (qid in names(r$answers)) {
      a <- r$answers[[qid]]
      if (is.list(a) && !is.null(names(a))) {
        # grid answers (meeting or likert): named list row -> value, plus
        # optional "<slot> (parts)" lists of exact 30-min ISO instants
        for (slot in names(a)) {
          val <- a[[slot]]
          if (is.list(val) || length(val) > 1) {
            row[[paste0(qid, ": ", slot)]] <- paste(unlist(val), collapse = "; ")
          } else {
            row[[paste0(qid, ": ", slot)]] <- val %||% NA_character_
          }
        }
      } else if (is.list(a) || length(a) > 1) {
        row[[qid]] <- paste(unlist(a), collapse = "; ")
      } else if (length(a) == 0) {
        row[[qid]] <- NA_character_
      } else {
        row[[qid]] <- as.character(a)
      }
    }
    row
  })

  # Bind rows with possibly differing columns (e.g. skipped optional grids).
  all_cols <- unique(unlist(lapply(rows, names)))
  df <- do.call(rbind, lapply(rows, function(row) {
    as.data.frame(lapply(all_cols, function(cn) row[[cn]] %||% NA_character_),
                  stringsAsFactors = FALSE) |>
      stats::setNames(all_cols)
  }))
  df$submitted_at <- as.POSIXct(df$submitted_at, format = "%Y-%m-%dT%H:%M:%OS", tz = "UTC")
  rownames(df) <- NULL
  df[order(df$submitted_at), ]
}

`%||%` <- function(x, y) if (is.null(x)) y else x

base64enc_decode <- function(x) {
  jsonlite::base64_dec(gsub("\\s", "", x))
}

# Binary availability per candidate slot, sorted by most available.
# Any expressed availability counts: "yes", legacy "maybe", or painted
# "(parts)". Use cell_tally() for 30-minute resolution.
meeting_tally <- function(df, question_id) {
  cols <- grep(paste0("^", question_id, ": "), names(df), value = TRUE)
  cols <- cols[!grepl("\\(parts\\)$", cols)]
  if (length(cols) == 0) stop("No meeting-grid columns for question ", question_id)
  tally <- do.call(rbind, lapply(cols, function(cn) {
    slot <- sub(paste0("^", question_id, ": "), "", cn)
    vals <- df[[cn]]
    parts_cn <- paste0(cn, " (parts)")
    has_parts <- if (parts_cn %in% names(df)) {
      !is.na(df[[parts_cn]]) & nzchar(df[[parts_cn]])
    } else FALSE
    available <- (!is.na(vals) & vals %in% c("yes", "maybe")) | has_parts
    data.frame(
      slot = slot,
      available = sum(available),
      not_available = sum(!is.na(vals) & vals == "no" & !has_parts),
      unanswered = sum(is.na(vals) & !has_parts)
    )
  }))
  tally[order(-tally$available), ]
}

# when2meet-style availability per 30-minute cell. Uses the exact "(parts)"
# instants where present; full "yes" answers expand to all of the slot's
# cells (from the survey definition). Returns counts per UTC instant,
# sorted by availability; add a `tz` to see wall-clock times in that zone.
cell_tally <- function(df, question_id, survey_id,
                       tz = "UTC", definition = NULL, ...) {
  def <- definition %||% fetch_definition(survey_id, ...)
  matches <- Filter(function(x) identical(x$id, question_id), def$questions)
  if (length(matches) == 0) stop("Question ", question_id, " not in survey definition")
  q <- matches[[1]]
  step_ms <- 30 * 60 * 1000

  slot_cells <- function(slot) {
    if (!is.null(q$slotCells[[slot]])) {
      return(as.numeric(as.POSIXct(unlist(q$slotCells[[slot]]),
                                   format = "%Y-%m-%dT%H:%M:%OS", tz = "UTC")) * 1000)
    }
    t <- q$slotTimes[[slot]]
    if (is.null(t)) return(numeric(0))
    s <- as.numeric(as.POSIXct(t$start, format = "%Y-%m-%dT%H:%M:%OS", tz = "UTC")) * 1000
    e <- as.numeric(as.POSIXct(t$end, format = "%Y-%m-%dT%H:%M:%OS", tz = "UTC")) * 1000
    seq(s, e - 1, by = step_ms)
  }

  counts <- new.env(parent = emptyenv())
  bump <- function(ts) {
    k <- as.character(ts)
    counts[[k]] <- (counts[[k]] %||% 0L) + 1L
  }
  for (slot in unlist(q$slots)) {
    status_col <- paste0(question_id, ": ", slot)
    parts_col <- paste0(question_id, ": ", slot, " (parts)")
    for (i in seq_len(nrow(df))) {
      status <- if (status_col %in% names(df)) df[[status_col]][i] else NA_character_
      parts <- if (parts_col %in% names(df)) df[[parts_col]][i] else NA_character_
      if (!is.na(parts) && nzchar(parts)) {
        instants <- strsplit(parts, "; ")[[1]]
        for (p in instants) {
          bump(as.numeric(as.POSIXct(p, format = "%Y-%m-%dT%H:%M:%OS", tz = "UTC")) * 1000)
        }
      } else if (!is.na(status) && status %in% c("yes", "maybe")) {
        for (ts in slot_cells(slot)) bump(ts)
      }
    }
  }
  keys <- ls(counts)
  if (length(keys) == 0) return(data.frame())
  ts <- as.numeric(keys)
  out <- data.frame(
    utc = as.POSIXct(ts / 1000, origin = "1970-01-01", tz = "UTC"),
    available = vapply(keys, function(k) counts[[k]], integer(1))
  )
  out$local <- format(out$utc, tz = tz, usetz = TRUE)
  out <- out[order(-out$available, out$utc), ]
  rownames(out) <- NULL
  out[, c("local", "utc", "available")]
}

# Likert summary: per-statement counts across the scale plus a mean score
# (columns scored 1..k in the definition's scale order).
likert_tally <- function(df, question_id, survey_id, definition = NULL, ...) {
  def <- definition %||% fetch_definition(survey_id, ...)
  matches <- Filter(function(x) identical(x$id, question_id), def$questions)
  if (length(matches) == 0) stop("Question ", question_id, " not in survey definition")
  q <- matches[[1]]
  cols <- unlist(q$scale)
  do.call(rbind, lapply(unlist(q$rows), function(rowLabel) {
    cn <- paste0(question_id, ": ", rowLabel)
    vals <- if (cn %in% names(df)) df[[cn]] else rep(NA_character_, nrow(df))
    counts <- vapply(cols, function(c) sum(vals == c, na.rm = TRUE), integer(1))
    answered <- sum(counts)
    mean_score <- if (answered) sum(counts * seq_along(cols)) / answered else NA_real_
    as.data.frame(c(
      list(statement = rowLabel),
      stats::setNames(as.list(counts), cols),
      list(no_answer = sum(is.na(vals)), mean = round(mean_score, 2))
    ), stringsAsFactors = FALSE)
  }))
}

# Numeric question: convert a column to numeric (answers are stored as text
# in the data frame) and summarize.
number_summary <- function(df, question_id) {
  v <- suppressWarnings(as.numeric(df[[question_id]]))
  v <- v[is.finite(v)]
  if (!length(v)) return(NULL)
  list(n = length(v), mean = mean(v), median = stats::median(v),
       min = min(v), max = max(v), values = v)
}

# Convenience: fetch and write a CSV next to your analysis.
save_responses_csv <- function(survey_id, file = paste0(survey_id, "_responses.csv"), ...) {
  df <- fetch_responses(survey_id, ...)
  utils::write.csv(df, file, row.names = FALSE)
  message("Wrote ", nrow(df), " responses to ", file)
  invisible(df)
}
