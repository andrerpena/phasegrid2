function(pg_apply_warnings target)
  target_compile_options(${target} PRIVATE
    -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Wno-sign-conversion
    -Werror=return-type -Werror=switch)
  if(PG_WERROR)
    target_compile_options(${target} PRIVATE -Werror)
  endif()
endfunction()
