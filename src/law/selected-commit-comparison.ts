import { OfficeLawRepositoryComparison } from "./repository-comparison";
import type { GitCommand } from "./repository-comparison";
import type { RepositoryLawSnapshot } from "./history";

export class OfficeLawSelectedCommitComparison{
	public destructor():void{}

	public static async compare(
		git:GitCommand,root:utf8_t,base:utf8_t,hash:utf8_t
	):Promise<RepositoryLawSnapshot>{
		const output=await git(root,[
			"rev-list","--parents","-n","1",hash
		]);
		const parents=output.trim().split(" ");
		const snapshot=await OfficeLawRepositoryComparison.compare(
			git,root,base,parents[1],hash
		);
		return{...snapshot,comparisonVersion:hash};
	}
};
