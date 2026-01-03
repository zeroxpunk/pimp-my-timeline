export interface AboutAccountResponse {
  data?: {
    user_result_by_screen_name?: {
      result?: {
        about_profile?: {
          account_based_in?: string;
        };
      };
    };
  };
}

