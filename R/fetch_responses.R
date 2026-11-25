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
        # meeting grid: named list slot -> yes/no/maybe
        for (slot in names(a)) {
          row[[paste0(qid, ": ", slot)]] <- a[[slot]] %||% NA_character_
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

# Availability tally for a meeting-grid question: counts of yes/no/maybe
# per candidate slot, sorted by most "yes" votes.
meeting_tally <- function(df, question_id) {
  cols <- grep(paste0("^", question_id, ": "), names(df), value = TRUE)
  if (length(cols) == 0) stop("No meeting-grid columns for question ", question_id)
  tally <- do.call(rbind, lapply(cols, function(cn) {
    vals <- df[[cn]]
    data.frame(
      slot = sub(paste0("^", question_id, ": "), "", cn),
      yes = sum(vals == "yes", na.rm = TRUE),
      maybe = sum(vals == "maybe", na.rm = TRUE),
      no = sum(vals == "no", na.rm = TRUE),
      unanswered = sum(is.na(vals))
    )
  }))
  tally[order(-tally$yes, -tally$maybe), ]
}

# Convenience: fetch and write a CSV next to your analysis.
save_responses_csv <- function(survey_id, file = paste0(survey_id, "_responses.csv"), ...) {
  df <- fetch_responses(survey_id, ...)
  utils::write.csv(df, file, row.names = FALSE)
  message("Wrote ", nrow(df), " responses to ", file)
  invisible(df)
}